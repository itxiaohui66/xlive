<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import Hls from 'hls.js';
import mpegts from 'mpegts.js';
import { api } from '../api';
import { useAppStore } from '../stores/app';

type Quality = { label: string; flv?: string; hls: string };
type Room = { roomNumber:number; title:string; description?:string; cover?:string; announcement?:string; streamStatus:'LIVE'|'OFFLINE'|'BANNED'; viewerCount:number; showViewerCount:boolean; owner:{nickname:string;avatar?:string}; category?:{name:string}; playback?:{hls:string;flv?:string;qualities?:Quality[];protocol?:'FLV'|'HLS'} };
type ChatMessage = { id:string; nickname:string; avatar?:string; content:string; createdAt:string; offsetSeconds?:number|null };
type Replay = { id:string; startedAt:string; endedAt:string; durationSeconds?:number; peakViewers:number; totalViews:number; recordingUrl:string };
type Bullet = { key:number; content:string; nickname:string; lane:number; color:string; duration:number };

const route=useRoute(),app=useAppStore();
const room=ref<Room|null>(null),replays=ref<Replay[]>([]),selectedReplay=ref<Replay|null>(null),error=ref('');
const video=ref<HTMLVideoElement>(),box=ref<HTMLDivElement>(),status=ref(''),count=ref(0),messages=ref<ChatMessage[]>([]),chatText=ref(''),chatStatus=ref('连接中…');
const playing=ref(true),muted=ref(true),fps=ref('--'),latency=ref('--'),quality=ref<Quality|null>(null),qOpen=ref(false),danmakuEnabled=ref(true),bullets=ref<Bullet[]>([]),replayDanmaku=ref<ChatMessage[]>([]),currentTime=ref(0),duration=ref(0);
const isReplay=computed(()=>selectedReplay.value!==null),hasVideo=computed(()=>room.value?.streamStatus==='LIVE'||isReplay.value);
let hls:Hls|null=null,flv:ReturnType<typeof mpegts.createPlayer>|null=null,heartbeatTimer=0,statsTimer=0,lastFrames=0,ws:WebSocket|null=null,bulletKey=0,nextDanmaku=0;

function cleanupPlayer(){clearInterval(statsTimer);lastFrames=0;fps.value='--';latency.value='--';hls?.destroy();hls=null;flv?.destroy();flv=null;if(video.value){video.value.removeAttribute('src');video.value.load()}}
async function load(){
  cleanupPlayer();selectedReplay.value=null;error.value='';
  try{
    room.value=(await api<{data:Room}>(`/api/rooms/${route.params.roomNumber}`)).data;count.value=room.value.viewerCount;
    replays.value=(await api<{data:Replay[]}>(`/api/rooms/${route.params.roomNumber}/replays`)).data;
    const replayId=String(route.query.replay??'');const target=replayId?replays.value.find(r=>r.id===replayId):null;
    if(target){await selectReplay(target)}else if(room.value.streamStatus==='LIVE'&&room.value.playback){await nextTick();playLive(room.value.playback)}
  }catch(value){error.value=(value as Error).message}
}
function playLive(playback:{hls:string;flv?:string;qualities?:Quality[];protocol?:'FLV'|'HLS'}){quality.value=playback.qualities?.[0]??{label:'原画',flv:playback.flv,hls:playback.hls};startQuality(quality.value)}
function startQuality(item:Quality){
  if(!video.value)return;cleanupPlayer();quality.value=item;
  if(room.value?.playback?.protocol==='HLS'){if(Hls.isSupported())startHls(item.hls);else if(video.value.canPlayType('application/vnd.apple.mpegurl'))video.value.src=item.hls}
  else if(item.flv&&mpegts.isSupported()){
    flv=mpegts.createPlayer({type:'flv',isLive:true,url:item.flv,enableStashBuffer:false});flv.attachMediaElement(video.value);flv.load();flv.play();
    flv.on(mpegts.Events.ERROR,()=>{flv?.destroy();flv=null;startHls(item.hls)});
  }else if(Hls.isSupported())startHls(item.hls);else if(video.value.canPlayType('application/vnd.apple.mpegurl'))video.value.src=item.hls;
  video.value.play().catch(()=>status.value='点击播放按钮开始观看');statsTimer=window.setInterval(sampleStats,1000);
}
function startHls(url:string){
  if(!video.value)return;hls=new Hls({liveSyncDurationCount:1,maxLiveSyncPlaybackRate:1.25});hls.loadSource(url);hls.attachMedia(video.value);
  hls.on(Hls.Events.MANIFEST_PARSED,()=>video.value?.play().catch(()=>status.value='点击播放按钮开始观看'));
  hls.on(Hls.Events.ERROR,(_event,detail)=>{if(detail.fatal){status.value='直播连接中断，正在重连…';if(detail.type===Hls.ErrorTypes.NETWORK_ERROR)hls?.startLoad();else hls?.recoverMediaError()}});
}
async function selectReplay(replay:Replay){
  cleanupPlayer();selectedReplay.value=replay;qOpen.value=false;status.value='';bullets.value=[];currentTime.value=0;duration.value=replay.durationSeconds??0;
  replayDanmaku.value=(await api<{data:ChatMessage[]}>(`/api/replays/${replay.id}/danmaku`)).data;nextDanmaku=0;
  await nextTick();if(!video.value)return;
  if(mpegts.isSupported()){flv=mpegts.createPlayer({type:'flv',isLive:false,url:replay.recordingUrl,enableWorker:true,lazyLoad:true});flv.attachMediaElement(video.value);flv.load();flv.play()}else video.value.src=replay.recordingUrl;
  video.value.play().catch(()=>status.value='点击播放按钮观看回放');
}
async function returnToLive(){cleanupPlayer();selectedReplay.value=null;replayDanmaku.value=[];bullets.value=[];await nextTick();if(room.value?.streamStatus==='LIVE'&&room.value.playback)playLive(room.value.playback)}
function switchQuality(item:Quality){if(item.label===quality.value?.label)return;qOpen.value=false;startQuality(item)}
function togglePlay(){const element=video.value;if(!element)return;element.paused?element.play().catch(()=>status.value='点击播放按钮开始观看'):element.pause()}
function toggleMute(){if(video.value)video.value.muted=!video.value.muted}
function setVolume(event:Event){const element=video.value;if(!element)return;element.volume=Number((event.target as HTMLInputElement).value);element.muted=element.volume===0}
function seek(event:Event){if(!video.value)return;video.value.currentTime=Number((event.target as HTMLInputElement).value);resetReplayCursor()}
function toggleFullscreen(){if(!box.value)return;document.fullscreenElement?document.exitFullscreen().catch(()=>{}):box.value.requestFullscreen().catch(()=>{})}
function sampleStats(){const element=video.value;if(!element)return;const stats=element.getVideoPlaybackQuality?.();if(stats){fps.value=String(stats.totalVideoFrames-lastFrames);lastFrames=stats.totalVideoFrames}if(hls&&hls.latency>0)latency.value=`${Math.round(hls.latency*1000)}ms`;else if(flv&&!isReplay.value){const end=element.buffered.length?element.buffered.end(element.buffered.length-1):0;if(end>element.currentTime)latency.value=`${Math.round((end-element.currentTime)*1000+300)}ms`}}
function formatTime(value:number){if(!Number.isFinite(value))return'00:00';const h=Math.floor(value/3600),m=Math.floor(value%3600/60),s=Math.floor(value%60);return h?`${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`:`${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`}
function pushBullet(message:ChatMessage){if(!danmakuEnabled.value)return;const key=++bulletKey;const colors=['#fff','#ffe36e','#7ee7ff','#ff9cce','#a7ff9b'];bullets.value.push({key,content:message.content,nickname:message.nickname,lane:key%6,color:colors[key%colors.length]!,duration:8+(key%4)});window.setTimeout(()=>bullets.value=bullets.value.filter(item=>item.key!==key),13000)}
function resetReplayCursor(){const time=video.value?.currentTime??0;bullets.value=[];nextDanmaku=replayDanmaku.value.findIndex(item=>(item.offsetSeconds??0)>=time);if(nextDanmaku<0)nextDanmaku=replayDanmaku.value.length}
function onTimeUpdate(){const element=video.value;if(!element)return;currentTime.value=element.currentTime;duration.value=Number.isFinite(element.duration)?element.duration:(selectedReplay.value?.durationSeconds??0);if(!isReplay.value)return;while(nextDanmaku<replayDanmaku.value.length&&(replayDanmaku.value[nextDanmaku]!.offsetSeconds??0)<=element.currentTime+.15){const item=replayDanmaku.value[nextDanmaku++]!;if((item.offsetSeconds??0)>=element.currentTime-1)pushBullet(item)}}
async function heartbeat(){try{const result=await api<{data:{viewerCount:number|null}}>(`/api/rooms/${route.params.roomNumber}/viewers/heartbeat`,{method:'POST'});if(result.data.viewerCount!==null)count.value=result.data.viewerCount}catch{}}
function connectChat(){
  ws?.close();const protocol=location.protocol==='https:'?'wss:':'ws:';ws=new WebSocket(`${protocol}//${location.host}/api/rooms/${route.params.roomNumber}/chat`);
  ws.onopen=()=>chatStatus.value=app.user?'已连接':'只读浏览';ws.onclose=()=>chatStatus.value='连接已断开';
  ws.onmessage=event=>{const payload=JSON.parse(event.data);if(payload.type==='history')messages.value=payload.messages;if(payload.type==='message'){messages.value.push(payload.message);if(!isReplay.value)pushBullet(payload.message)}if(payload.type==='error')chatStatus.value=payload.message};
}
function sendChat(){if(!app.user){chatStatus.value='请先登录后参与聊天';return}const content=chatText.value.trim();if(!content||ws?.readyState!==WebSocket.OPEN)return;ws.send(JSON.stringify({content}));chatText.value=''}
onMounted(async()=>{await load();heartbeat();connectChat();heartbeatTimer=window.setInterval(heartbeat,15000)});
onBeforeUnmount(()=>{clearInterval(heartbeatTimer);cleanupPlayer();ws?.close()});
watch(()=>route.params.roomNumber,async()=>{await load();connectChat()});
</script>

<template>
  <p v-if="error" class="panel error">{{error}}</p>
  <div v-else-if="room" class="room-layout">
    <section>
      <div class="panel streamer"><img class="avatar" :src="room.owner.avatar||''"><div><h2>{{room.title}}</h2><div class="muted">{{room.owner.nickname}} · {{room.category?.name??'未分类'}} · {{count}} 人在线</div></div><button v-if="isReplay" class="button live-return" @click="returnToLive">返回直播</button></div>
      <div ref="box" class="player" :class="{'danmaku-paused':!playing}">
        <video v-if="hasVideo" ref="video" playsinline muted autoplay @click="togglePlay" @dblclick="toggleFullscreen" @play="playing=true" @pause="playing=false" @volumechange="muted=video?.muted??true" @timeupdate="onTimeUpdate" @seeking="resetReplayCursor"></video>
        <div v-else class="offline"><h2>{{room.streamStatus==='BANNED'?'直播间已暂停':'主播暂未开播'}}</h2><p>{{replays.length?'可以在下方观看往期回放。':'可以先收藏房间，稍后再来。'}}</p></div>
        <div v-if="hasVideo&&danmakuEnabled" class="danmaku-layer"><span v-for="item in bullets" :key="item.key" class="danmaku-item" :style="{top:`${8+item.lane*13}%`,color:item.color,animationDuration:`${item.duration}s`}"><b>{{item.nickname}}</b> {{item.content}}</span></div>
        <div v-if="hasVideo" class="player-top"><span v-if="isReplay" class="chip replay-chip">回放</span><template v-else><span class="chip">帧率 {{fps}}</span><span v-if="app.settings['live.showPlayerLatency']" class="chip">延迟 {{latency}}</span></template></div>
        <div v-if="hasVideo" class="player-bar" :class="{visible:!playing}"><button class="pbtn" title="播放/暂停" @click="togglePlay"><svg viewBox="0 0 24 24" fill="currentColor"><path :d="playing?'M6 5h4v14H6zM14 5h4v14h-4z':'M8 5v14l11-7z'"/></svg></button><button class="pbtn" :title="muted?'取消静音':'静音'" @click="toggleMute"><svg viewBox="0 0 24 24" fill="currentColor"><path :d="muted?'M3 9v6h4l5 5V4L7 9H3zm12.6 3l2.1-2.1-1.4-1.4-2.1 2.1-2.1-2.1-1.4 1.4 2.1 2.1-2.1 2.1 1.4 1.4 2.1-2.1 2.1 2.1 1.4-1.4z':'M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 00-2.5-4.03v8.06a4.5 4.5 0 002.5-4.03z'"/></svg></button><input class="vol" type="range" min="0" max="1" step="0.05" value="1" @input="setVolume"><template v-if="isReplay"><span class="time-label">{{formatTime(currentTime)}}</span><input class="replay-progress" type="range" min="0" :max="duration||1" step="0.1" :value="currentTime" @input="seek"><span class="time-label">{{formatTime(duration)}}</span></template><button class="pbtn danmaku-toggle" :class="{off:!danmakuEnabled}" :title="danmakuEnabled?'关闭弹幕':'开启弹幕'" @click="danmakuEnabled=!danmakuEnabled">弹</button><button v-if="!isReplay" class="pbtn qbtn" title="清晰度" @click="qOpen=!qOpen">{{quality?.label}}<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 10l5 5 5-5z"/></svg></button><button class="pbtn" title="全屏" @click="toggleFullscreen"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg></button></div>
        <div v-if="qOpen&&!isReplay" class="qmenu"><button v-for="item in room.playback?.qualities??[]" :key="item.label" :class="{active:item.label===quality?.label}" @click="switchQuality(item)">{{item.label}}</button></div>
        <button v-if="hasVideo&&!playing" class="big-play" title="播放" @click="togglePlay"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></button><span v-if="status" class="live-badge">{{status}}</span>
      </div>
      <div v-if="replays.length" class="panel replay-section"><div class="section-head compact"><div><h3>直播回放</h3><span class="muted">共 {{replays.length}} 场</span></div></div><div class="replay-list"><button v-for="item in replays" :key="item.id" class="replay-card" :class="{active:item.id===selectedReplay?.id}" @click="selectReplay(item)"><span class="replay-icon">▶</span><span><strong>{{new Date(item.startedAt).toLocaleString()}}</strong><small>{{formatTime(item.durationSeconds??0)}} · 峰值 {{item.peakViewers}} 人</small></span></button></div></div>
      <div class="panel room-description"><h3>直播简介</h3><p class="muted">{{room.description||'主播还没有填写直播简介。'}}</p><h3>直播公告</h3><p class="muted">{{room.announcement||'暂无公告'}}</p></div>
    </section>
    <aside class="panel chat"><h3>聊天室 <small class="muted">{{chatStatus}}</small></h3><div class="chat-list"><p v-for="message in messages" :key="message.id"><strong>{{message.nickname}}</strong> <span>{{message.content}}</span><br><small class="muted">{{new Date(message.createdAt).toLocaleTimeString()}}</small></p></div><p v-if="!app.user" class="muted"><router-link class="table-link" to="/login">登录</router-link> 后即可参与聊天</p><div class="search"><input v-model="chatText" class="input" maxlength="500" :placeholder="app.user?'发送聊天与弹幕…':'登录后发送消息'" :disabled="!app.user" @keyup.enter="sendChat"><button class="button" :disabled="!app.user" @click="sendChat">发送</button></div></aside>
  </div>
  <p v-else class="muted">正在进入直播间…</p>
</template>
