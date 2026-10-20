import{HERO_LOADOUTS,WEAPONS,MAPS}from'./rules.js?v=228';
import{RoomClient,ROOM_HERO_NAMES,parseRoomAddress,roomInvitation}from'./multiplayer-client.js?v=228';

export class RoomLobby{
 constructor({client=new RoomClient(),document=globalThis.document,onOffline=()=>{},onSelection=()=>{},invitationURL=globalThis.location?.href}={}){
  this.client=client;this.document=document;this.onOffline=onOffline;this.onSelection=onSelection;this.scores=[];this.busy=false;this.previousFocus=null;
  let invitation;try{invitation=parseRoomAddress(invitationURL);}catch{invitation=parseRoomAddress('http://127.0.0.1:8898/');}
  this.invitation=invitation;this.hasInvitation=!!invitation.token;
  this.unsubscribers=[];this.build();
  this.unsubscribers.push(client.on('room',room=>this.renderRoom(room)),client.on('status',s=>this.setStatus(s.text)),client.on('error',e=>{this.busy=false;this.renderRoom(client.room);this.setStatus(e.message,true);}),client.on('closed',e=>{const inGame=['loading','playing'].includes(this.lastPhase);this.busy=false;this.renderRoom(null);this.setStatus(e.reason,true);if(inGame)this.hide();else this.show();}),client.on('latency',value=>{this.connection.textContent='往返延迟 '+value+' 毫秒';}));
 }
 element(tag,className,text){const node=this.document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
 button(text,action,className=''){const button=this.element('button',className,text);button.type='button';button.addEventListener('click',action);return button;}
 field(label,control){const wrap=this.element('label','room-field');control.setAttribute('aria-label',label);wrap.append(this.element('span','',label),control);return wrap;}
 input(type,placeholder,maxLength){const input=this.element('input');input.type=type;input.placeholder=placeholder;if(maxLength)input.maxLength=maxLength;return input;}
 options(select,entries){select.replaceChildren(...entries.map(([value,label])=>{const option=this.element('option','',label);option.value=value;return option;}));}
 build(){
  const d=this.document;
  if(!d.querySelector('link[data-room-style]')){const style=d.createElement('link');style.rel='stylesheet';style.href=new URL('./multiplayer.css?v=228',import.meta.url).href;style.dataset.roomStyle='';d.head.append(style);}
  this.dialog=this.element('dialog','room-dialog');this.dialog.setAttribute('aria-labelledby','room-title');
  const header=this.element('header','room-header'),title=this.element('h2','','好友私人房间');title.id='room-title';
  header.append(title,this.button('收起',()=>this.hide(),'room-dismiss'));
  const body=this.element('div','room-body'),intro=this.element('p','room-intro','最多 4 人 · 玩家互相对战，场上也有怪物。房主电脑需保持运行，离线单机仍可独立进入。');
  this.connection=this.element('small','room-connection');
  this.setup=this.element('section','room-setup');
  this.address=this.input('text','粘贴房主的完整邀请链接');this.address.value=this.invitation.url;this.address.spellcheck=false;this.address.autocomplete='off';
  this.token=this.input('password','完整邀请链接会自动填入密钥',256);this.token.value=this.invitation.token;this.token.autocomplete='off';
  this.name=this.input('text','你的称呼',24);this.name.value='冒险者';this.name.autocomplete='nickname';
  this.code=this.input('text','房间码',12);this.code.value=this.invitation.code;this.code.autocomplete='off';this.code.spellcheck=false;this.code.style.textTransform='uppercase';
  const connectionFields=this.element('div','room-fields');connectionFields.append(this.field('房主地址 / 邀请链接',this.address),this.field('邀请密钥',this.token),this.field('你的名字',this.name),this.field('加入房间时填写',this.code));
  const help=this.element('details','room-help'),summary=this.element('summary','','怎样连接朋友的房间？');
  help.append(summary,this.element('p','','房主在电脑双击 START_ONLINE_ROOM.cmd，等本次 HTTPS 入口检查通过后打开游戏，创建房间再复制完整邀请。朋友用手机或电脑浏览器打开即可，不需要安装 VPN 或组网软件。'),this.element('p','','双方保持正常联网。房主电脑的服务窗口与游戏页都需保持打开；关闭或重启服务后，旧邀请会失效，请获取新链接。邀请链接含密钥，只发给一起玩的朋友。'));
  this.setup.append(connectionFields,help);
  this.selection=this.element('section','room-selection');this.hero=this.element('select');this.weapon=this.element('select');this.map=this.element('select');
  this.options(this.hero,Object.keys(HERO_LOADOUTS).map(id=>[id,ROOM_HERO_NAMES[id]]));this.hero.value='silver';this.options(this.map,Object.entries(MAPS).map(([id,map])=>[id,map.name]));this.map.value='forest';this.renderWeapons();
  this.selection.append(this.field('冒险者',this.hero),this.field('随行武器',this.weapon),this.field('房主选择地图',this.map));
  this.hero.addEventListener('change',()=>{this.renderWeapons();this.selectionChanged();});this.weapon.addEventListener('change',()=>this.selectionChanged());
  this.map.addEventListener('change',()=>{if(this.client.room)this.client.setMap(this.map.value);});
  this.address.addEventListener('change',()=>{try{const parsed=parseRoomAddress(this.address.value);if(parsed.token)this.token.value=parsed.token;if(parsed.code)this.code.value=parsed.code;this.address.value=parsed.url;}catch(error){this.setStatus(error.message,true);}});
  this.roomInfo=this.element('section','room-info');this.roomInfo.hidden=true;
  this.roomLabel=this.element('strong','room-label');this.roster=this.element('ul','room-roster');this.roster.setAttribute('aria-label','房间玩家');
  const inviteRow=this.element('div','room-invitation');this.invite=this.input('text','',2048);this.invite.readOnly=true;this.invite.setAttribute('aria-label','完整房间邀请链接');
  inviteRow.append(this.invite,this.button('复制邀请',()=>this.copyInvitation()));this.roomInfo.append(this.roomLabel,this.roster,inviteRow);
  this.status=this.element('p','room-status');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
  this.playerMarkers=this.element('div','room-player-markers');this.playerMarkers.setAttribute('aria-hidden','true');this.markerNodes=new Map();d.body.append(this.playerMarkers);
  this.hostPage=this.element('a','room-host-page','打开房主游戏页');this.hostPage.hidden=true;this.hostPage.referrerPolicy='no-referrer';
  this.scoreboard=this.element('section','room-scores');this.scoreboard.hidden=true;this.scoreboard.setAttribute('aria-label','本局战况');
  const footer=this.element('footer','room-footer');this.actions=this.element('div','room-actions');
  this.createButton=this.button('创建私人房间',()=>this.enter(true),'room-primary');this.joinButton=this.button('加入房间',()=>this.enter(false));
  this.readyButton=this.button('准备',()=>{const self=this.client.room?.players.find(p=>p.id===this.client.playerId);this.client.setReady(!self?.ready);},'room-primary');
  this.startButton=this.button('开始对战',()=>this.client.start(),'room-primary');
  this.leaveButton=this.button('离开房间',()=>this.client.leave());
  this.offlineButton=this.button('返回离线单机',()=>{if(this.client.connected)this.client.leave();this.hide();this.onOffline();});
  this.actions.append(this.createButton,this.joinButton,this.readyButton,this.startButton,this.leaveButton);footer.append(this.actions,this.offlineButton);
  body.append(intro,this.connection,this.setup,this.selection,this.roomInfo,this.scoreboard,this.status,this.hostPage);this.dialog.append(header,body,footer);d.body.append(this.dialog);
  this.dialog.addEventListener('cancel',event=>{event.preventDefault();this.hide();});
  this.dialog.addEventListener('close',()=>this.previousFocus?.focus?.());this.renderRoom(null);
 }
 mount(container){if(!this.entryButton){this.entryButton=this.button('好友房间',()=>this.show(),'room-entry');this.entryButton.id='room-open';}container.append(this.entryButton);return this.entryButton;}
 show(selection){
  if(selection&&!this.client.room){if(Object.hasOwn(HERO_LOADOUTS,selection.heroId))this.hero.value=selection.heroId;this.renderWeapons(selection.weaponIndex);if(Object.hasOwn(MAPS,selection.mapId))this.map.value=selection.mapId;}
  if(this.dialog.open)return;this.previousFocus=this.document.activeElement;this.dialog.showModal();
 }
 hide(){if(this.dialog.open)this.dialog.close();}
 setStatus(text,error=false){this.status.textContent=text||'';this.status.dataset.error=String(error);}
 renderWeapons(index=0){this.options(this.weapon,HERO_LOADOUTS[this.hero.value].map((id,i)=>[String(i),WEAPONS[id].name]));this.weapon.value=String(index);if(this.weapon.selectedIndex<0)this.weapon.value='0';}
 selectionChanged(){const selection={heroId:this.hero.value,weaponIndex:Number(this.weapon.value)};if(this.client.room)this.client.select(selection.heroId,selection.weaponIndex);this.onSelection(selection);}
 async enter(create){
  if(this.busy)return;
  if(!this.name.value.trim()){this.setStatus('先填一个名字，让朋友认出你。',true);this.name.focus();return;}
  let parsed;try{parsed=parseRoomAddress(this.address.value);if(parsed.code)this.code.value=parsed.code;if(parsed.token)this.token.value=parsed.token;}catch(error){this.setStatus(error.message,true);return;}
  this.hostPage.hidden=true;
  if(globalThis.location?.origin&&globalThis.location.origin!==parsed.url){
   if(!this.token.value){this.setStatus('请粘贴房主的完整邀请链接，其中包含进入房主游戏页的密钥。',true);return;}
   this.hostPage.href=roomInvitation(parsed.url,this.token.value,this.code.value.trim().toUpperCase());this.hostPage.hidden=false;this.setStatus('这个房间需要从房主提供的游戏页面进入。点击下方链接，载入后再创建或加入。');return;
  }
  if(!create&&!this.code.value.trim()){this.setStatus('请输入房主分享的房间码。',true);this.code.focus();return;}
  this.busy=true;this.renderRoom(null);
  try{
   await this.client.connect({url:parsed.url,token:parsed.token||this.token.value});
   const selection={name:this.name.value.trim(),heroId:this.hero.value,weaponIndex:Number(this.weapon.value)};
   if(create)this.client.create({...selection,mapId:this.map.value});else this.client.join({...selection,code:this.code.value.trim().toUpperCase()});
   this.setStatus(create?'正在建立私人房间…':'正在加入房间…');
  }catch(error){this.busy=false;this.setStatus(error.message,true);this.renderRoom(null);}
 }
 renderRoom(room){
  const previousPhase=this.lastPhase;this.lastPhase=room?.phase||null;
  if(room)this.busy=false;
  this.setup.hidden=!!room;this.roomInfo.hidden=!room;
  if(room)this.hostPage.hidden=true;
  this.createButton.hidden=!!room;this.joinButton.hidden=!!room;this.readyButton.hidden=!room||room.phase!=='lobby';this.startButton.hidden=!room||!this.client.isHost||room.phase!=='lobby';this.leaveButton.hidden=!room;
  this.createButton.disabled=this.busy;this.joinButton.disabled=this.busy;
  this.hero.disabled=this.weapon.disabled=this.busy||!!room&&room.phase!=='lobby';this.map.disabled=this.busy||!!room&&(!this.client.isHost||room.phase!=='lobby');
  this.dialog.setAttribute('aria-busy',String(this.busy||room?.phase==='loading'));
  if(this.entryButton)this.entryButton.textContent=room?'房间 '+room.code:'好友房间';
  if(!room){this.roster.replaceChildren();this.connection.textContent=this.client.connected?'已连接房主电脑。':'';this.scoreboard.hidden=true;this.clearPlayerMarkers();return;}
  const self=room.players.find(p=>p.id===this.client.playerId);if(self){this.hero.value=self.heroId;this.renderWeapons(self.weaponIndex);}
  this.map.value=room.mapId;this.roomLabel.textContent='房间 '+room.code+' · '+room.players.length+'/4 · '+MAPS[room.mapId].name;
  this.readyButton.textContent=self?.ready?'取消准备':'准备';this.readyButton.setAttribute('aria-pressed',String(!!self?.ready));
  this.startButton.disabled=room.players.length<2||room.players.some(p=>!p.ready);
  this.invite.value=this.client.inviteURL();this.roster.replaceChildren(...room.players.map(player=>{
   const row=this.element('li'),name=this.element('strong','',player.name+(player.id===this.client.playerId?'（你）':'')+(player.id===room.hostId?' · 房主':''));
   row.append(name,this.element('span','',ROOM_HERO_NAMES[player.heroId]+' · '+WEAPONS[HERO_LOADOUTS[player.heroId][player.weaponIndex]].name),this.element('small','',room.phase==='loading'?(player.loaded?'已载入':'正在载入…'):room.phase==='playing'?'对战中':player.ready?'已准备':'未准备'));row.dataset.ready=String(player.ready);return row;
  }));
  if(room.phase==='loading')this.setStatus('各设备正在准备场景；全部就绪后一起开始。');
  else if(room.phase==='playing'){this.setStatus(room.paused?(room.pauseReason==='choice'?'有玩家正在选择成长奖励，全体对局暂时停下；选完后继续。':'房主暂时离开或暂停对局；等待房主继续。'):'玩家对战中。房主离开页面时会暂停全体对局；离开房间可继续离线单机。');if(previousPhase!=='playing')this.hide();}
  else this.setStatus(room.players.length<2?'邀请一位朋友加入，再各自点击准备。':room.players.every(p=>p.ready)?'全部玩家已准备，由房主开始对战。':'选择人物与武器，然后点击准备。');
  this.setScores(this.scores);
 }
 async copyInvitation(){
  this.invite.select();
  try{await globalThis.navigator.clipboard.writeText(this.invite.value);this.setStatus('邀请链接已复制；仅发给准备一起玩的朋友。');}
  catch{this.setStatus('邀请链接已选中，长按复制或按 Ctrl+C。');}
 }
 setScores(scores=[]){
  this.scores=Array.isArray(scores)?scores.slice(0,4):[];this.scoreboard.hidden=!this.client.room||!this.scores.length;
  this.scoreboard.replaceChildren(...this.scores.map(score=>{
   const player=this.client.room?.players.find(p=>p.id===score.id),row=this.element('p');if(!player)return row;
   const numeric=key=>Number.isFinite(score[key])?Math.max(0,Math.floor(score[key])):0;
   row.textContent=player.name+' · 击败玩家 '+numeric('kills')+' · 倒地 '+numeric('deaths')+' · 击败怪物 '+numeric('monsters');return row;
  }));
 }
 clearPlayerMarkers(){this.playerMarkers.replaceChildren();this.markerNodes.clear();}
 updatePlayers(owners,camera,localId){
  if(!owners||!camera||!localId||this.client.room?.phase!=='playing'){if(this.markerNodes.size)this.clearPlayerMarkers();return;}
  const view=this.document.defaultView,width=view.innerWidth,height=view.innerHeight,seen=new Set();
  camera.updateMatrixWorld();
  for(const owner of owners.values()){
   if(owner.id===localId||seen.size>=3||!owner.hero?.position?.clone)continue;
   seen.add(owner.id);
   let marker=this.markerNodes.get(owner.id);
   if(!marker){const element=this.element('div','room-player-marker'),name=this.element('span','room-player-name'),health=this.element('span','room-player-health'),fill=this.element('i');health.append(fill);element.append(name,health);this.playerMarkers.append(element);marker={element,name,health,fill,point:owner.hero.position.clone()};this.markerNodes.set(owner.id,marker);}
   const player=owner.player,dead=!!player.networkDead||player.hp<=0;
   // Concealment remains gameplay: a nameplate must not reveal an invisible player.
   if(!dead&&(player.mirageHidden||owner.heroId==='tide'&&player.dashTime>0||owner.hero.visible===false)){marker.element.hidden=true;continue;}
   owner.hero.getWorldPosition(marker.point);marker.point.y+=Math.max(1,player.standHeight||1.65)+.18;marker.point.project(camera);
   const p=marker.point;
   if(![p.x,p.y,p.z].every(Number.isFinite)||p.z< -1||p.z>1||Math.abs(p.x)>.96||Math.abs(p.y)>.93){marker.element.hidden=true;continue;}
   marker.element.hidden=false;marker.element.dataset.dead=String(dead);marker.element.style.left=((p.x+1)*width/2).toFixed(1)+'px';marker.element.style.top=((1-p.y)*height/2).toFixed(1)+'px';
   const name=this.client.room.players.find(member=>member.id===owner.id)?.name||owner.name||'冒险者',label=name+(dead?' · 倒地':'');if(marker.name.textContent!==label)marker.name.textContent=label;
   const ratio=Number.isFinite(player.hp)&&player.maxHp>0?Math.max(0,Math.min(1,player.hp/player.maxHp)):0;marker.fill.style.transform='scaleX('+ratio.toFixed(3)+')';marker.health.hidden=dead;
  }
  for(const[id,marker]of this.markerNodes)if(!seen.has(id)){marker.element.remove();this.markerNodes.delete(id);}
 }
 destroy(){this.unsubscribers.forEach(unsubscribe=>unsubscribe());this.dialog.remove();this.playerMarkers.remove();this.markerNodes.clear();this.entryButton?.remove();}
}
