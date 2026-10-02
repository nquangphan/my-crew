#define _DARWIN_C_SOURCE
#include <sys/stat.h>
#include <sys/types.h>
#include <fcntl.h>
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
static void identity(struct stat *s){
  printf("{\"device\":\"%llu\",\"inode\":\"%llu\",\"ownerUid\":%u,\"kind\":\"directory\",\"linkCount\":%u}\n",(unsigned long long)s->st_dev,(unsigned long long)s->st_ino,s->st_uid,s->st_nlink);
}
/* Every descent is relative to the held directory fd; links and foreign mounts fail closed. */
static int tree(int fd,dev_t dev,int remove_entries){
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
    struct stat s;
    if(fstatat(fd,e->d_name,&s,AT_SYMLINK_NOFOLLOW)||s.st_uid!=getuid()||s.st_dev!=dev||S_ISLNK(s.st_mode)){
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
    else if(S_ISREG(s.st_mode)&&s.st_nlink==1){
      if(remove_entries){
        struct stat current;
        if(fstatat(fd,e->d_name,&current,AT_SYMLINK_NOFOLLOW)||current.st_ino!=s.st_ino||current.st_dev!=s.st_dev||current.st_nlink!=1||!S_ISREG(current.st_mode)||unlinkat(fd,e->d_name,0)){
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
  return result;
}
int main(int argc,char **argv){
  /* mode root root-dev root-ino parent parent-dev parent-ino name
     [object-dev object-ino object-nlink destination-dev destination-ino] */
  if(argc<9||!safe_name(argv[5])||!safe_name(argv[8]))return 2;
  int root=open(argv[2],O_RDONLY|O_DIRECTORY|O_NOFOLLOW);
  struct stat rs;
  if(root<0||fstat(root,&rs)||!match(&rs,argv[3],argv[4]))return 3;
  int parent=dir_at(root,argv[5],argv[6],argv[7]);
  if(parent<0){
    close(root);
    return 3;
  }
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
  if(fstat(child,&s)||s.st_nlink!=(nlink_t)strtoul(argv[11],NULL,10)||tree(child,s.st_dev,0)){
    close(child);
    close(parent);
    close(root);
    return 7;
  }
  if(!strcmp(argv[1],"recover")){
    if(argc!=14){
      close(child);
      close(parent);
      close(root);
      return 2;
    }
    int objects=dir_at(root,"objects",argv[12],argv[13]);
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
