import React from 'react';

export function chatProviderLabel(provider?: string) {
  return provider==='dsh'?'DeepSeek Harness':provider==='codex'?'Codex':provider==='api'?'API':'未连接';
}

export function performanceLabel(performance?: any) {
  if (performance?.connected) return 'MCP 已连接';
  if (performance?.registered || performance?.dshConnected) return 'MCP 已接入 · 空闲';
  return 'MCP 未连接';
}

export function ConnectionStatus({connection}:{connection:any}) {
  const performance=connection?.performance;
  const provider=chatProviderLabel(connection?.providerEffective);
  const offline=connection?.providerEffective==='dsh'&&!connection?.chatAvailable;
  const wasConnected=connection?.dsh?.everConnected||connection?.dsh?.reconnecting||connection?.providerReason==='dsh-remembered';
  const state=offline?(wasConnected?' · 已断线':connection?.chatStatus==='bridge-disabled'?' · 聊天桥未启用':' · 聊天桥未连接'):'';
  const performanceState=performanceLabel(performance);
  const performanceClass=performance?.connected?'channel connected':(performance?.registered||performance?.dshConnected)?'channel idle':'channel';
  return <div className="channel-status" aria-label="表演与对话连接状态">
    <span data-channel="performance" className={performanceClass}
      title={`空闲表示 MCP 客户端已注册但最近没有工具调用，不等于断开。按最近 ${Math.round((performance?.leaseMs||65000)/1000)} 秒的活动判断；表演连接不等于聊天可用。`}>
      <i/><span>表演：{performanceState}</span>
    </span>
    <span data-channel="chat" className={`channel connection${connection?.chatAvailable?' connected':''}`} title={connection?.chatMessage||'等待连接信息'}>
      <i/><span>对话：{provider}{state}</span>
    </span>
  </div>;
}

export function connectionMessage(connection:any) {
  if(connection?.providerEffective==='dsh'&&connection?.chatAvailable)
    return `当前由 DSH 提供对话；MCP 表演通道${performanceLabel(connection.performance)}。`;
  return connection?.chatMessage||'等待智能体连接。';
}
