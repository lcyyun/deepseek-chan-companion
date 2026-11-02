export function createMoveQueue(send: (delta: {dx:number;dy:number}) => unknown, options?: {schedule?: (callback:()=>void)=>any;cancel?: (timer:any)=>void}): {
  push(dx:number,dy:number):void; flush():void; cancel():void; dispose():void;
};
export function quantizeRegion(rect:any, grid?:number): {x:number;y:number;width:number;height:number}|null;
