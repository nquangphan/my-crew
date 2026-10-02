/* Unsigned owned fake FD3 protocol. Does not link Security.framework or access Keychain. */
#include <stdint.h>
#include <unistd.h>
#include <arpa/inet.h>
#include <stdlib.h>
#include <string.h>
static int receive(void *p,size_t n) {char *b=p;while(n){ssize_t r=read(3,b,n);if(r<=0)return 1;b+=r;n-=r;}return 0;}
int main(int argc,char **argv) {
  (void)argv;if(argc!=1)return 1;
  uint32_t h[4];if(receive(h,sizeof(h)))return 1;uint32_t op=ntohl(h[0]),sn=ntohl(h[1]),an=ntohl(h[2]),vn=ntohl(h[3]);
  if(sn>220 || an>200 || vn>8192)return 1;
  char s[221]={0},a[201]={0},v[8193]={0};if(receive(s,sn)||receive(a,an)||receive(v,vn))return 1;
  if(strcmp(s,"com.2pcrew.v2.fixture.provider") || strcmp(a,"fixture-operation"))return 1;
  if(op==1 && strcmp(v,"channel-fixture"))return 1;
  const char *value=op==2?"channel-fixture":"";
  uint32_t reply[2]={htonl(0),htonl((uint32_t)strlen(value))};
  if(write(3,reply,sizeof(reply))!=(ssize_t)sizeof(reply))return 1;
  if(*value && write(3,value,strlen(value))!=(ssize_t)strlen(value))return 1;
  memset(v,0,sizeof(v));return 0;
}
