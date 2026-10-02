/* One request per dedicated FD 3. No credential argv/environment/stdout/stderr.
 * Compile/package/sign only in phase09. Never run unsigned against owner Keychain. */
#include <CoreFoundation/CoreFoundation.h>
#include <Security/Security.h>
#import <Foundation/Foundation.h>
#import <LocalAuthentication/LocalAuthentication.h>
static void wipe(void *p, size_t n) {volatile unsigned char *b=p;while(n--)*b++=0;}
#include <arpa/inet.h>
#include <errno.h>
#include <stdint.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
static int io(int fd, void *bytes, size_t n, int writing) {
  unsigned char *p = bytes;
  while(n) {ssize_t r=writing?write(fd,p,n):read(fd,p,n);if(r<0 && errno==EINTR)continue;if(r<=0)return -1;p+=r;n-=(size_t)r;}return 0;
}
static int reply(int32_t status,const void *bytes,uint32_t n) {
  uint32_t h[2]={htonl((uint32_t)status),htonl(n)};
  if(io(3,h,sizeof(h),1)<0)return 1;
  return n && io(3,(void*)bytes,n,1)<0?1:0;
}
int main(void) {
  uint32_t h[4];if(io(3,h,sizeof(h),0)<0)return 1;
  uint32_t op=ntohl(h[0]),sn=ntohl(h[1]),an=ntohl(h[2]),vn=ntohl(h[3]);
  if(op<1 || op>3 || sn<15 || sn>220 || an<1 || an>200 || vn>8192 || (op!=1 && vn))return 1;
  char service[221]={0},account[201]={0};unsigned char value[8192]={0};
  if(io(3,service,sn,0)<0 || io(3,account,an,0)<0 || io(3,value,vn,0)<0)return 1;
  if(strncmp(service,"com.2pcrew.v2.",13)!=0 || strlen(service)!=sn || strlen(account)!=an) {wipe(value,sizeof(value));return 1;}
  CFStringRef s=CFStringCreateWithBytes(NULL,(UInt8*)service,sn,kCFStringEncodingUTF8,false),a=CFStringCreateWithBytes(NULL,(UInt8*)account,an,kCFStringEncodingUTF8,false);
  if(!s || !a) {wipe(value,sizeof(value));if(s)CFRelease(s);if(a)CFRelease(a);return 1;}
  CFMutableDictionaryRef q=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
  CFDictionarySetValue(q,kSecClass,kSecClassGenericPassword);CFDictionarySetValue(q,kSecAttrService,s);CFDictionarySetValue(q,kSecAttrAccount,a);
  CFDictionarySetValue(q,kSecUseDataProtectionKeychain,kCFBooleanTrue);
  LAContext *context=[[LAContext alloc] init]; context.interactionNotAllowed=YES;
  CFDictionarySetValue(q,kSecUseAuthenticationContext,(__bridge CFTypeRef)context);
  OSStatus status=errSecParam;CFTypeRef data=NULL;
  if(op==1) {
    CFDataRef d=CFDataCreate(NULL,value,vn);CFMutableDictionaryRef update=CFDictionaryCreateMutable(NULL,0,&kCFTypeDictionaryKeyCallBacks,&kCFTypeDictionaryValueCallBacks);
    CFDictionarySetValue(update,kSecValueData,d);status=SecItemUpdate(q,update);
    if(status==errSecItemNotFound) {
      CFDictionarySetValue(q,kSecValueData,d);CFDictionarySetValue(q,kSecAttrAccessible,kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly);CFDictionarySetValue(q,kSecAttrSynchronizable,kCFBooleanFalse);status=SecItemAdd(q,NULL);
    }
    CFRelease(update);CFRelease(d);
  } else if(op==2) {CFDictionarySetValue(q,kSecReturnData,kCFBooleanTrue);CFDictionarySetValue(q,kSecMatchLimit,kSecMatchLimitOne);status=SecItemCopyMatching(q,&data);}
  else {status=SecItemDelete(q);if(status==errSecItemNotFound)status=errSecSuccess;}
  wipe(value,sizeof(value));int result;
  if(status==errSecItemNotFound && op==2)result=reply(1,NULL,0);
  else if(status!=errSecSuccess)result=reply(-1,NULL,0);
  else if(op==2) {
    if(!data || CFGetTypeID(data)!=CFDataGetTypeID() || CFDataGetLength((CFDataRef)data)>8192)result=reply(-1,NULL,0);
    else result=reply(0,CFDataGetBytePtr((CFDataRef)data),(uint32_t)CFDataGetLength((CFDataRef)data));
  } else result=reply(0,NULL,0);
  if(data)CFRelease(data);CFRelease(q);CFRelease(s);CFRelease(a);return result;
}
