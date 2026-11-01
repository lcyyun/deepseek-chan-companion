import React from 'react';

export function chatProviderLabel(provider?: string) {
  return provider==='dsh'?'DeepSeek Harness':provider==='codex'?'Codex':provider==='api'?'API':'未连接';
}

export function ConnectionStatus({connection}:{connection:any}) {
  const performance=connection?.performance;
  const provider=chatProviderLabel(connection?.providerEffective);
  const offline=connection?.providerEffective==='dsh'&&!connection?.chatAvailable;
  const wasConnected=connection?.dsh?.everConnected||connection?.dsh?.reconnecting||connection?.providerReason==='dsh-remembered';
  const state=offline?(wasConnected?' · 已断线':connection?.chatStatus==='bridge-disabled'?' · 聊天桥未启用':' · 聊天桥未连接'):'';
  return <div className="channel-status" aria-label="表演与对话连接状态">
    <span data-channel="performance" className={performance?.connected?'channel connected':'channel'}
      title={`按最近 ${Math.round((performance?.leaseMs||65000)/1000)} 秒的已认证 MCP 活动判断；表演连接不等于聊天可用。`}>
      <i/><span>表演：{performance?.connected?'MCP 已连接':'MCP 未连接'}</span>
    </span>
    <span data-channel="chat" className={`channel connection${connection?.chatAvailable?' connected':''}`} title={connection?.chatMessage||'等待连接信息'}>
      <i/><span>对话：{provider}{state}</span>
    </span>
  </div>;
}

export function connectionMessage(connection:any) {
  if(connection?.providerEffective==='dsh'&&connection?.chatAvailable)
    return `当前由 DSH 提供对话；MCP 表演通道${connection.performance?.connected?'已连接':'未连接'}。`;
  return connection?.chatMessage||'等待智能体连接。';
}
