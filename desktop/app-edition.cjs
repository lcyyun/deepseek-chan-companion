'use strict';
// Edition is a build artifact, never a preference or environment override.
function editionConfig(value) {
  const developer = value === 'developer';
  return Object.freeze({ edition:developer?'developer':'user', developerTools:developer,
    appName:developer?'大肥鱼 · 开发版':'大肥鱼 · DeepSeek-chan',
    profileDirectory:developer?'DeepSeek-chan-developer-data':'DeepSeek-chan-data',
    port:developer?39182:39181, dshPort:developer?63617:63616,
  });
}
const DEVELOPER_CONTROLS = new Set(['render-quality','render-buffer-cache','render-state-snapshots',
  'render-sample','copy-performance','start-gpu-timing','gpu-timing-status','chest-reaction']);
module.exports={editionConfig,DEVELOPER_CONTROLS};
