#include <libproc.h>
#include <sys/proc_info.h>
#include <sys/sysctl.h>
#include <stdlib.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>
#include <sys/event.h>
#include <sys/wait.h>
#include <fcntl.h>
#include <errno.h>
/* macOS NOTE_TRACK is unsupported: any fork makes full-tree proof unknown.
   The initial child blocks on a pipe until NOTE_FORK|NOTE_EXIT is armed. */
static int supervise(int argc,char **argv){
  if(argc<3)return 2;
  int gate[2];
  if(pipe(gate))return 3;
  int queue=kqueue();
  if(queue<0)return 3;
  pid_t child=fork();
  if(child<0)return 3;
  if(child==0){
    close(gate[1]);
    close(queue);
    char byte;
    if(read(gate[0],&byte,1)!=1)_exit(126);
    close(gate[0]);
    int null=open("/dev/null",O_RDWR);
    if(null<0)_exit(126);
    dup2(null,STDIN_FILENO);
    dup2(null,STDOUT_FILENO);
    dup2(null,STDERR_FILENO);
    if(null>2)close(null);
    execvp(argv[2],&argv[2]);
    _exit(127);
  }
  close(gate[0]);
  struct kevent change;
  EV_SET(&change,child,EVFILT_PROC,EV_ADD|EV_CLEAR,NOTE_FORK|NOTE_EXIT,0,NULL);
  if(kevent(queue,&change,1,NULL,0,NULL)<0){
    close(gate[1]);
    waitpid(child,NULL,0);
    close(queue);
    return 4;
  }
  char byte=1;
  if(write(gate[1],&byte,1)!=1){
    close(gate[1]);
    waitpid(child,NULL,0);
    close(queue);
    return 4;
  }
  close(gate[1]);
  int forked=0,exited=0;
  while(!exited){
    struct kevent event;
    int count=kevent(queue,NULL,0,&event,1,NULL);
    if(count<0&&errno==EINTR)continue;
    if(count!=1||(event.flags&EV_ERROR)){
      close(queue);
      waitpid(child,NULL,0);
      return 5;
    }
    if(event.fflags&NOTE_FORK)forked=1;
    if(event.fflags&NOTE_EXIT)exited=1;
  }
  int status=0;
  pid_t waited;
  do{
    waited=waitpid(child,&status,0);
  }
  while(waited<0&&errno==EINTR);
  close(queue);
  if(waited!=child)return 5;
  int code=WIFEXITED(status)?WEXITSTATUS(status):128+(WIFSIGNALED(status)?WTERMSIG(status):0);
  printf("{\"treeEmpty\":%s,\"forkObserved\":%s,\"exitCode\":%d}\n",forked?"false":"true",forked?"true":"false",code);
  return 0;
}
int main(int argc, char **argv) {
  if(argc>=3&&!strcmp(argv[1],"supervise"))return supervise(argc,argv);
  if (argc != 3) return 2;
  int pid=atoi(argv[2]);
  if(pid<=0)return 2;
  if(!strcmp(argv[1],"identity")){
    struct proc_bsdinfo p;
    memset(&p,0,sizeof(p));
    if(proc_pidinfo(pid,PROC_PIDTBSDINFO,0,&p,sizeof(p))!=sizeof(p))return 3;
    if(p.pbi_status==SZOMB)return 3;
    printf("{\"pid\":%u,\"uid\":%u,\"processGroupId\":%u,\"birth\":\"%llu:%llu\"}\n",p.pbi_pid,p.pbi_uid,p.pbi_pgid,p.pbi_start_tvsec,p.pbi_start_tvusec);
    return 0;
  }
  if(!strcmp(argv[1],"group")){
    int mib[4]={CTL_KERN,KERN_PROC,KERN_PROC_PGRP,pid};
    size_t bytes=0;
    if(sysctl(mib,4,NULL,&bytes,NULL,0))return 3;
    if(bytes==0){
      printf("0\n");
      return 0;
    }
    struct kinfo_proc *items=calloc(1,bytes);
    if(!items)return 3;
    if(sysctl(mib,4,items,&bytes,NULL,0)){
      free(items);
      return 3;
    }
    int live=0;
    for(size_t i=0;i<bytes/sizeof(struct kinfo_proc);i++)if(items[i].kp_proc.p_stat!=SZOMB)live++;
    free(items);
    printf("%d\n",live);
    return 0;
  }
  return 2;
}
