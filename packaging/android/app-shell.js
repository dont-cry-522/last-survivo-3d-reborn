// APK only. The actual game modules, assets and persistent keys are unchanged.
// Assets are bundled, so don't duplicate them into a service worker cache or offer
// browser-only download/install controls inside the installed app.
const panel = document.querySelector('#offline-panel');
if (panel) {
  panel.querySelector('summary').textContent = '离线版';
  panel.querySelector('.offline-popover').replaceChildren();
  const note = document.createElement('p');
  note.textContent = 'REBORN v230 · 地图、角色和声音已随安装包保存，可以断网游玩。更新时直接覆盖安装；卸载或清除应用数据会删除本应用存档。参加好友房间请用手机浏览器打开邀请链接，此 APK 为离线版。';
  panel.querySelector('.offline-popover').append(note);
}
const style = document.createElement('style');
style.textContent = '#landscape,#orientation-help{display:none!important}';
document.head.append(style);
const loadingDetail = document.querySelector('#asset-loading-detail');
if (loadingDetail) loadingDetail.textContent = '正在读取本机资源，首次准备需要一点时间，无需联网。';
