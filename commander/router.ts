import type { AgentName } from "./taskTypes.js";
export type Route={agent:AgentName;objective:string};
export function routeTask(routes:Route[]){return routes.map((route,index)=>({...route,order:index+1}));}