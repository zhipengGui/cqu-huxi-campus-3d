export function advanceFrame(last:number,now:number):number|null {
  const interval=1000/60,elapsed=now-last;
  if(elapsed<interval-.25)return null;
  return last+Math.max(1,Math.floor((elapsed+.25)/interval))*interval;
}
