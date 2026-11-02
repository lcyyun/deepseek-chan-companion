import React from 'react';

export function chatProviderLabel(provider?: string) {
  return provider==='dsh'?'DeepSeek Harness':provider==='codex'?'Codex':provider==='api'?'API':'未连接';
}

export function performanceLabel(performance?: any) {
  if (performance?.status === 'disconnected') return 'MCP 已断开';
  if (performance?.active) return 'MCP 已接入 · 活跃';
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
      title={`注册与最近活动分开记录。${Math.round((performance?.activityWindowMs||performance?.leaseMs||65000)/1000)} 秒无调用只表示空闲；连接面板会另行确认 DSH 是否已加载角色工具。`}>
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
