#define _DARWIN_C_SOURCE
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/event.h>
#include <sys/wait.h>
#include <sys/resource.h>
#include <sys/sysctl.h>
#include <stdint.h>
#include <time.h>
#include <signal.h>
#include <dirent.h>
#include <unistd.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <errno.h>
static int safe_name(const char *s){
  if(!s||!*s||strchr(s,'/')||!strcmp(s,".")||!strcmp(s,".."))return 0;
  return 1;
}
static int match(struct stat *s,const char *dev,const char *ino){
  return S_ISDIR(s->st_mode)&&s->st_uid==getuid()&&!(s->st_mode&077)&&s->st_dev==(dev_t)strtoull(dev,NULL,10)&&s->st_ino==(ino_t)strtoull(ino,NULL,10);
}
static int dir_at(int parent,const char *name,const char *dev,const char *ino){
  int fd=openat(parent,name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  if(fd<0)return -1;
  struct stat s;
  if(fstat(fd,&s)||!match(&s,dev,ino)){
    close(fd);
    return -1;
  }
  return fd;
}
static unsigned long long total_bytes;
static unsigned long scanned_entries;
static int scan_depth,scan_overflow;
static void identity(struct stat *s){
  printf("{\"device\":\"%llu\",\"inode\":\"%llu\",\"ownerUid\":%u,\"kind\":\"directory\",\"linkCount\":%u,\"bytes\":%llu}\n",(unsigned long long)s->st_dev,(unsigned long long)s->st_ino,s->st_uid,s->st_nlink,total_bytes);
}
/* Every descent is relative to the held directory fd; symlinks are unlinked as entries; foreign mounts and hardlinks fail closed. */
static int tree(int fd,dev_t dev,int remove_entries){
  if(++scan_depth>128){scan_overflow=1;return -1;}
  int copy=dup(fd);
  if(copy<0)return -1;
  DIR *d=fdopendir(copy);
  if(!d){
    close(copy);
    return -1;
  }
  rewinddir(d);
  struct dirent *e;
  int result=0;
  for(;;){
    errno=0;
    e=readdir(d);
    if(!e){if(errno)result=-1;break;}
    if(!strcmp(e->d_name,".")||!strcmp(e->d_name,".."))continue;
    if(++scanned_entries>30000){scan_overflow=1;result=-1;break;}
    struct stat s;
    if(fstatat(fd,e->d_name,&s,AT_SYMLINK_NOFOLLOW)||s.st_uid!=getuid()||s.st_dev!=dev){
      result=-1;
      break;
    }
    if(S_ISDIR(s.st_mode)){
      int child=openat(fd,e->d_name,O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
      struct stat current;
      if(child<0){
        result=-1;
        break;
      }
      if(fstat(child,&current)||current.st_dev!=s.st_dev||current.st_ino!=s.st_ino||tree(child,dev,remove_entries)){
        close(child);
        result=-1;
        break;
      }
      close(child);
      if(remove_entries){
        if(fstatat(fd,e->d_name,&current,AT_SYMLINK_NOFOLLOW)||current.st_ino!=s.st_ino||current.st_dev!=s.st_dev||unlinkat(fd,e->d_name,AT_REMOVEDIR)){
          result=-1;
          break;
        }
      }
    }
    else if((S_ISREG(s.st_mode)&&s.st_nlink==1)||S_ISLNK(s.st_mode)){
      total_bytes+=(unsigned long long)s.st_size;
      if(remove_entries){
        struct stat current;
        if(fstatat(fd,e->d_name,&current,AT_SYMLINK_NOFOLLOW)||current.st_ino!=s.st_ino||current.st_dev!=s.st_dev||current.st_nlink!=1||(!S_ISREG(current.st_mode)&&!S_ISLNK(current.st_mode))||unlinkat(fd,e->d_name,0)){
          result=-1;
          break;
        }
      }
    }
    else{
      result=-1;
      break;
    }
  }
  closedir(d);
  scan_depth--;
  return result;
}
/* execute-tree session tracking. KERN_PROC_SESSION answers ENOENT on current macOS. A member is a live (non-zombie)
   process from one KERN_PROC_ALL snapshot whose process group is known to belong to the session, or whose getsid()
   equals the leader pid. The group test reads the atomic snapshot, so a fork chain inside a known group cannot
   slip between listing and getsid(). Groups are learned from getsid()-confirmed members; a group never changes
   session. The leader stays unreaped (running or zombie) until tracking ends, so its pid cannot name another
   session or group. Caps (256 listed, 256 watched in total over the run, 256 groups) fail closed. */
#define SESSION_MAX 256
static struct kinfo_proc *proc_table;
static size_t proc_capacity;
static pid_t session_pids[SESSION_MAX];
static pid_t groups[SESSION_MAX];
static struct{pid_t pid;int exited,left;}members[SESSION_MAX];
static int member_count,group_count,untracked;
static int snapshot(void){
  int mib[3]={CTL_KERN,KERN_PROC,KERN_PROC_ALL};
  for(int attempt=0;attempt<4;attempt++){
    size_t size=0;if(sysctl(mib,3,NULL,&size,NULL,0))return -1;
    size+=size/4+16*sizeof(struct kinfo_proc);
    if(size>proc_capacity){struct kinfo_proc *grown=realloc(proc_table,size);if(!grown)return -1;proc_table=grown;proc_capacity=size;}
    size=proc_capacity;
    if(sysctl(mib,3,proc_table,&size,NULL,0)){if(errno==ENOMEM)continue;return -1;}
    return (int)(size/sizeof(struct kinfo_proc));
  }
  return -1;
}
static void learn_group(pid_t leader,pid_t pid){
  pid_t group=getpgid(pid);
  // The group is taken only if the same pid is still a member afterwards.
  if(group<=0||getsid(pid)!=leader)return;
  for(int i=0;i<group_count;i++)if(groups[i]==group)return;
  if(group_count==SESSION_MAX){untracked=1;return;}
  groups[group_count++]=group;
}
static int in_session(struct kinfo_proc *entry,pid_t leader){
  pid_t pid=entry->kp_proc.p_pid;
  if(pid<=0||pid==leader||entry->kp_proc.p_stat==SZOMB)return 0;
  for(int i=0;i<group_count;i++)if(entry->kp_eproc.e_pgid==groups[i])return 1;
  if(getsid(pid)!=leader)return 0;
  learn_group(leader,pid);
  return 1;
}
static int session_list(pid_t leader){
  int entries=snapshot();if(entries<0)return -1;
  int count=0;
  for(int i=0;i<entries;i++){
    if(!in_session(&proc_table[i],leader))continue;
    if(count==SESSION_MAX)return -1;
    session_pids[count++]=proc_table[i].kp_proc.p_pid;
  }
  return count;
}
/* A watched member whose getsid() names a live session other than the leader's left the session alive. Recorded
   when seen, so a later kill cannot erase the evidence. A dead or zombie member answers -1. */
static void note_escapes(pid_t leader){
  for(int i=0;i<member_count;i++){
    if(members[i].exited||members[i].left)continue;
    pid_t session=getsid(members[i].pid);
    if(session>0&&session!=leader)members[i].left=1;
  }
}
static int escapes(void){
  int count=untracked;
  for(int i=0;i<member_count;i++)if(members[i].left)count++;
  return count;
}
/* Every tree-mode kill: the leader's group and every learned group, each member of a fresh uncapped listing, and
   every watched member that has not exited (including ones that left the session). */
static void kill_session(pid_t leader){
  note_escapes(leader);
  for(int i=0;i<group_count;i++)kill(-groups[i],SIGKILL);
  kill(leader,SIGKILL);
  int entries=snapshot();
  for(int i=0;i<entries;i++)if(in_session(&proc_table[i],leader))kill(proc_table[i].kp_proc.p_pid,SIGKILL);
  for(int i=0;i<group_count;i++)kill(-groups[i],SIGKILL);
  for(int i=0;i<member_count;i++)if(!members[i].exited)kill(members[i].pid,SIGKILL);
}
/* Each member gets NOTE_EXIT, so leaving the session alive (setsid) is told apart from exiting, and NOTE_FORK, so
   a fork anywhere in the tree wakes the loop and lists the session at once. */
static void watch(int queue,pid_t leader,pid_t pid){
  for(int i=0;i<member_count;i++)if(members[i].pid==pid&&!members[i].exited)return;
  if(member_count==SESSION_MAX){untracked=1;return;}
  struct kevent change;EV_SET(&change,pid,EVFILT_PROC,EV_ADD|EV_CLEAR,NOTE_FORK|NOTE_EXIT,0,(void*)(intptr_t)(member_count+1));
  if(kevent(queue,&change,1,NULL,0,NULL)<0){if(errno!=ESRCH)untracked=1;return;}
  // Re-checked after arming so the watch belongs to the session member, not a pid reused in between.
  if(getsid(pid)!=leader){EV_SET(&change,pid,EVFILT_PROC,EV_DELETE,0,0,NULL);kevent(queue,&change,1,NULL,0,NULL);return;}
  members[member_count].pid=pid;members[member_count].exited=0;member_count++;
}
static void absorb(int queue,pid_t leader,long millis);
/* Error exits: kill until an uncapped listing shows no member and every watched member exited, at most 2 s. */
static void settle(int queue,pid_t leader){
  struct timespec start,now;if(clock_gettime(CLOCK_MONOTONIC,&start))start.tv_sec=0;
  for(;;){
    kill_session(leader);
    absorb(queue,leader,20);
    int entries=snapshot(),alive=entries<0;
    for(int i=0;i<entries&&!alive;i++)if(in_session(&proc_table[i],leader))alive=1;
    for(int i=0;i<member_count&&!alive;i++)if(!members[i].exited&&getsid(members[i].pid)>0)alive=1;
    if(!alive||clock_gettime(CLOCK_MONOTONIC,&now)||now.tv_sec-start.tv_sec>=2)return;
  }
}
static void member_event(struct kevent *event){
  intptr_t index=(intptr_t)event->udata;
  if(index>0&&index<=member_count&&members[index-1].pid==(pid_t)event->ident&&(event->fflags&NOTE_EXIT))members[index-1].exited=1;
}
static void absorb(int queue,pid_t leader,long millis){
  struct kevent event;struct timespec wait={millis/1000,(millis%1000)*1000000};
  while(kevent(queue,NULL,0,&event,1,&wait)==1){
    if(event.ident!=(uintptr_t)leader)member_event(&event);
    wait.tv_sec=0;wait.tv_nsec=0;
  }
}
static int execute_owned(int root,int fd,int argc,char **argv,int as_tree){
  if(argc<18)return 2;
  int receipts=dir_at(root,"receipts",argv[12],argv[13]);if(receipts<0)return 34;
  // execute ABI appends working-directory, timeout-seconds, absolute command and arguments.
  int seconds=atoi(argv[15]); if(seconds<1||seconds>120||argv[16][0]!='/')return 2;
  int gate[2]; if(pipe(gate))return 30;
  int queue=kqueue(); if(queue<0)return 30;
  pid_t child=fork(); if(child<0)return 30;
  if(child==0){
    close(gate[1]); close(queue); char byte;
    if(read(gate[0],&byte,1)!=1)_exit(126); close(gate[0]);
    // execute-tree: the leader starts its own session so every descendant that stays in it is enumerable.
    if((as_tree?setsid()<0:setpgid(0,0)!=0)||chdir(argv[14]))_exit(126);
    int log=openat(fd,"execution.log",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    int null=open("/dev/null",O_RDONLY);if(log<0||null<0)_exit(126);
    dup2(null,0);dup2(log,1);dup2(log,2);close(log);close(null);
    for(int inherited=3;inherited<getdtablesize();inherited++)close(inherited);
    struct rlimit size={64*1024*1024,64*1024*1024};setrlimit(RLIMIT_FSIZE,&size);
    // No inherited credentials, owner HOME, proxy or module paths reach the official installer.
    char home[4096];snprintf(home,sizeof(home),"HOME=%s/home",argv[14]);
    char temp[4096];snprintf(temp,sizeof(temp),"TMPDIR=%s/tmp",argv[14]);
    char cache[4096];snprintf(cache,sizeof(cache),"XDG_CACHE_HOME=%s/home",argv[14]);
    char config[4096];snprintf(config,sizeof(config),"XDG_CONFIG_HOME=%s/home",argv[14]);
    char data[4096];snprintf(data,sizeof(data),"XDG_DATA_HOME=%s/home",argv[14]);
    char *environment[]={home,temp,cache,config,data,"PATH=/usr/bin:/bin","CI=1","TZ=UTC","LANG=C",NULL};
    execve(argv[16],&argv[16],environment);_exit(127);
  }
  close(gate[0]);struct kevent change;
  EV_SET(&change,child,EVFILT_PROC,EV_ADD|EV_CLEAR,NOTE_FORK|NOTE_EXIT,0,NULL);
  if(kevent(queue,&change,1,NULL,0,NULL)<0){close(gate[1]);waitpid(child,NULL,0);return 31;}
  if(as_tree){
    groups[0]=child;group_count=1;
    // `receipts/{id}.leader` names the session leader ("pid start-seconds.microseconds") for reconcile after a
    // crash. It is written outside the stage, which the child can write, before the child is released.
    struct kinfo_proc info;size_t size=sizeof(info);int mib[4]={CTL_KERN,KERN_PROC,KERN_PROC_PID,child};
    char leader_name[256];snprintf(leader_name,sizeof(leader_name),"%s.leader",argv[8]);
    int leader=openat(receipts,leader_name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if(leader<0||sysctl(mib,4,&info,&size,NULL,0)||size!=sizeof(info)||info.kp_proc.p_pid!=child||dprintf(leader,"%d %lld.%06d\n",child,(long long)info.kp_proc.p_starttime.tv_sec,(int)info.kp_proc.p_starttime.tv_usec)<0||fsync(leader)||fsync(receipts)){
      if(leader>=0)close(leader);close(gate[1]);waitpid(child,NULL,0);return 36;
    }
    close(leader);
  }
  char byte=1;if(write(gate[1],&byte,1)!=1){close(gate[1]);waitpid(child,NULL,0);return 31;}close(gate[1]);
  struct stat owned;if(fstat(fd,&owned)){if(as_tree){settle(queue,child);waitpid(child,NULL,0);}return 35;}
  int forked=0,exited=0,timed=0,listed=0,max_session=1;struct timespec now;if(clock_gettime(CLOCK_MONOTONIC,&now)){if(as_tree){settle(queue,child);waitpid(child,NULL,0);}return 35;}time_t deadline=now.tv_sec+seconds;
  while(!exited){struct kevent event;struct timespec tick={1,0};int count=kevent(queue,NULL,0,&event,1,&tick);
    if(count<0&&errno==EINTR)continue;
    if(count<0||(count==1&&(event.flags&EV_ERROR))){if(as_tree)settle(queue,child);kill(child,SIGKILL);waitpid(child,NULL,0);return 32;}
    if(count==1&&event.ident!=(uintptr_t)child)member_event(&event);
    else if(count==1){if(event.fflags&NOTE_FORK)forked=1;if(event.fflags&NOTE_EXIT)exited=1;}
    if(as_tree&&!exited){
      listed=session_list(child);
      if(listed<0){settle(queue,child);waitpid(child,NULL,0);return 32;}
      if(listed+1>max_session)max_session=listed+1;
      for(int i=0;i<listed;i++)watch(queue,child,session_pids[i]);
      note_escapes(child);
    }
    total_bytes=0;scanned_entries=0;scan_depth=0;scan_overflow=0;int accounted=tree(fd,owned.st_dev,0);
    if(clock_gettime(CLOCK_MONOTONIC,&now)){if(as_tree)settle(queue,child);kill(child,SIGKILL);waitpid(child,NULL,0);return 35;}
    if(!exited&&(scan_overflow||(accounted==0&&total_bytes>256ULL*1024*1024)||now.tv_sec>=deadline)){timed=1;kill(-child,SIGKILL);kill(child,SIGKILL);if(as_tree)kill_session(child);}
  }
  int survivors=0,escaped=0,drained=0;
  if(as_tree){
    // Judged at leader exit, before reaping it: members still in the session survived the leader.
    absorb(queue,child,0);
    survivors=session_list(child);
    // A member may fork between the listing and its getsid(); an empty answer is confirmed once more.
    if(survivors==0)survivors=session_list(child);
    if(survivors<0){settle(queue,child);waitpid(child,NULL,0);return 32;}
    note_escapes(child);
    escaped=escapes();
    struct timespec started;if(clock_gettime(CLOCK_MONOTONIC,&started)){settle(queue,child);waitpid(child,NULL,0);return 35;}
    for(;;){
      int remaining=session_list(child);if(remaining<0){settle(queue,child);break;}
      int alive=0;for(int i=0;i<member_count;i++)if(!members[i].exited)alive++;
      if(remaining==0&&alive==0){drained=session_list(child)==0;break;}
      // Anything still to kill after the leader exited means the session was not empty at that moment,
      // even if both exit listings missed it; such a run is never proven.
      if(!timed&&survivors==0&&escaped==0)survivors=remaining>0?remaining:1;
      if(clock_gettime(CLOCK_MONOTONIC,&now)||now.tv_sec-started.tv_sec>=2)break;
      kill_session(child);
      absorb(queue,child,20);
    }
    // An escape noticed while killing after the leader exit is reported as well.
    if(escapes()>escaped)escaped=escapes();
    if(untracked)drained=0;
  }
  int status;pid_t waited;do{waited=waitpid(child,&status,0);}while(waited<0&&errno==EINTR);close(queue);
  if(waited!=child)return 32;int code=WIFEXITED(status)?WEXITSTATUS(status):128+(WIFSIGNALED(status)?WTERMSIG(status):0);
  char receipt_name[256];snprintf(receipt_name,sizeof(receipt_name),"%s.json",argv[8]);
  int receipt=openat(receipts,receipt_name,O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);if(receipt<0)return 33;
  // Tree receipts append their fields; treeEmpty there means the session was proven empty after the leader.
  char extra[192]="";
  if(as_tree)snprintf(extra,sizeof(extra),",\"mode\":\"tree\",\"sessionEmptyAtExit\":%s,\"survivors\":%d,\"escaped\":%d,\"maxSessionSize\":%d",survivors==0?"true":"false",survivors,escaped,max_session);
  if(dprintf(receipt,"{\"formatVersion\":1,\"operationId\":\"%s\",\"device\":\"%llu\",\"inode\":\"%llu\",\"treeEmpty\":%s,\"forkObserved\":%s,\"exitCode\":%d,\"timedOut\":%s%s}",argv[8],(unsigned long long)owned.st_dev,(unsigned long long)owned.st_ino,as_tree?(drained?"true":"false"):(forked?"false":"true"),forked?"true":"false",code,timed?"true":"false",extra)<0||fsync(receipt)||fsync(receipts))return 33;
  close(receipt);return 0;
}
int main(int argc,char **argv){
  /* mode root root-dev root-ino parent parent-dev parent-ino name
     [object-dev object-ino object-nlink destination-dev destination-ino] */
  if(argc<9||!safe_name(argv[5])||!safe_name(argv[8]))return 2;
  int root=open(argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  struct stat rs;
  if(root<0||fstat(root,&rs)||!match(&rs,argv[3],argv[4]))return 3;
  int guard=openat(root,".operations.guard",O_RDWR|O_CREAT|O_NOFOLLOW,0600);
  /* 24: the guard is not a private regular file of this user; 20: another operation holds it. */
  struct stat gs;if(guard<0||fstat(guard,&gs)||!S_ISREG(gs.st_mode)||gs.st_uid!=getuid()||gs.st_nlink!=1||(gs.st_mode&077))return 24;
  if(flock(guard,LOCK_EX|LOCK_NB))return errno==EWOULDBLOCK?20:24;
  int parent=dir_at(root,argv[5],argv[6],argv[7]);
  if(parent<0){
    close(root);
    return 3;
  }
  if(!strcmp(argv[1],"absent")){struct stat entry;if(fstatat(parent,argv[8],&entry,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT)return 22;return fsync(parent)?23:0;}
  if(!strcmp(argv[1],"create")){
    if(mkdirat(parent,argv[8],0700)){
      close(parent);
      close(root);
      return 4;
    }
    int child=openat(parent,argv[8],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
    struct stat s;
    if(child<0||fstat(child,&s)||fsync(child)||fsync(parent)){
      if(child>=0)close(child);
      close(parent);
      close(root);
      return 5;
    }
    int marker=openat(child,".operation-owner",O_WRONLY|O_CREAT|O_EXCL|O_NOFOLLOW,0600);
    if(marker<0)return 21;
    if(dprintf(marker,"%s %llu %llu\n",argv[8],(unsigned long long)s.st_dev,(unsigned long long)s.st_ino)<0||fsync(marker)||fsync(child))return 21;
    close(marker);
    identity(&s);
    close(child);
    close(parent);
    close(root);
    return 0;
  }
  if(argc<12){
    close(parent);
    close(root);
    return 2;
  }
  int child=dir_at(parent,argv[8],argv[9],argv[10]);
  if(child<0){
    close(parent);
    close(root);
    return 6;
  }
  struct stat s;
  /* argv[11] remains an observational directory link-count snapshot for ABI compatibility.
     Runtime contents and partial deletion change it; regular-file aliases still fail in tree(). */
  if(fstat(child,&s)||tree(child,s.st_dev,0)){
    close(child);
    close(parent);
    close(root);
    return 7;
  }
  if(!strcmp(argv[1],"execute")){return execute_owned(root,child,argc,argv,0);}
  if(!strcmp(argv[1],"execute-tree")){return execute_owned(root,child,argc,argv,1);}
  if(!strcmp(argv[1],"inspect")){identity(&s);}
  else if(!strcmp(argv[1],"recover")){
    if(argc!=14){
      close(child);
      close(parent);
      close(root);
      return 2;
    }
    int objects=dir_at(root,"stages",argv[12],argv[13]);
    struct stat check;
    if(objects<0||fstatat(objects,argv[8],&check,AT_SYMLINK_NOFOLLOW)==0||errno!=ENOENT){
      if(objects>=0)close(objects);
      close(child);
      close(parent);
      close(root);
      return 13;
    }
    close(objects);
    identity(&s);
  }
  else if(!strcmp(argv[1],"quarantine")){
    if(argc!=14){
      close(child);
      close(parent);
      close(root);
      return 2;
    }
    int q=dir_at(root,"quarantine",argv[12],argv[13]);
    if(q<0){
      close(child);
      close(parent);
      close(root);
      return 6;
    }
    if(renameatx_np(parent,argv[8],q,argv[8],RENAME_EXCL)){
      close(q);
      close(child);
      close(parent);
      close(root);
      return 8;
    }
    struct stat after;
    if(fstatat(q,argv[8],&after,AT_SYMLINK_NOFOLLOW)||after.st_dev!=s.st_dev||after.st_ino!=s.st_ino||!match(&after,argv[9],argv[10])||fsync(parent)||fsync(q)){
      close(q);
      close(child);
      close(parent);
      close(root);
      return 9;
    }
    identity(&after);
    close(q);
  }
  else if(!strcmp(argv[1],"attest")){
    if(fsync(child)){
      close(child);
      close(parent);
      close(root);
      return 12;
    }
    identity(&s);
  }
  else if(!strcmp(argv[1],"delete")){
    total_bytes=0;scanned_entries=0;scan_depth=0;scan_overflow=0;
    if(tree(child,s.st_dev,1)){
      close(child);
      close(parent);
      close(root);
      return 10;
    }
    struct stat after;
    if(fstatat(parent,argv[8],&after,AT_SYMLINK_NOFOLLOW)||after.st_dev!=s.st_dev||after.st_ino!=s.st_ino||unlinkat(parent,argv[8],AT_REMOVEDIR)||fsync(parent)){
      close(child);
      close(parent);
      close(root);
      return 11;
    }
  }
  else {
    close(child);
    close(parent);
    close(root);
    return 2;
  }
  close(child);
  close(parent);
  close(root);
  return 0;
}
