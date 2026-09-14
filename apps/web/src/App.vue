<script setup lang="ts">
import { computed, onMounted, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { NConfigProvider, NDialogProvider, NMessageProvider, NModal, NCard, NInput, NButton, darkTheme, zhCN, dateZhCN } from 'naive-ui';
import { useAppStore } from './stores/app';
const store=useAppStore(),router=useRouter(); const enterOpen=ref(false),roomNumber=ref('');
const mode=ref(localStorage.getItem('theme')??'system'); const systemDark=matchMedia('(prefers-color-scheme: dark)'); const tick=ref(systemDark.matches); systemDark.addEventListener('change',e=>tick.value=e.matches);
const dark=computed(()=>mode.value==='dark'||(mode.value==='system'&&tick.value));
watchEffect(()=>{document.documentElement.dataset.theme=dark.value?'dark':'light'; localStorage.setItem('theme',mode.value)});
onMounted(()=>store.bootstrap());
function enter(){if(/^\d+$/.test(roomNumber.value)){enterOpen.value=false;router.push(`/room/${roomNumber.value}`)}}
</script>
<template><NConfigProvider :theme="dark?darkTheme:null" :locale="zhCN" :date-locale="dateZhCN"><NDialogProvider><NMessageProvider>
  <div class="shell"><header class="header"><router-link class="brand" to="/"><img v-if="store.settings[dark?'site.darkLogo':'site.logo']" :src="String(store.settings[dark?'site.darkLogo':'site.logo'])"><span>{{store.settings['site.name']}}</span></router-link>
    <nav><router-link to="/">首页</router-link><router-link to="/categories">分类</router-link><router-link to="/replays">回放</router-link><button class="text-button" @click="enterOpen=true">进入房间</button></nav>
    <div class="header-actions"><select v-model="mode" class="theme-select" aria-label="主题"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select>
      <template v-if="store.user"><router-link to="/me/room">我的直播间</router-link><router-link v-if="store.isAdmin" to="/admin">管理后台</router-link><router-link to="/me">{{store.user.nickname}}</router-link><button class="text-button" @click="store.logout();router.push('/')">退出</button></template>
      <template v-else><router-link to="/login">登录</router-link><router-link class="primary-link" to="/register">注册</router-link></template></div></header>
    <main><router-view/></main><footer><span>{{store.settings['site.copyright']}}</span><span>{{store.settings['site.footer']}}</span><a v-if="store.settings['site.icp.text']" :href="String(store.settings['site.icp.url']||'#')">{{store.settings['site.icp.text']}}</a></footer></div>
  <NModal v-model:show="enterOpen"><NCard title="进入直播间" closable @close="enterOpen=false" style="width:min(420px,92vw)"><NInput v-model:value="roomNumber" placeholder="请输入房间号，如 10001" @keyup.enter="enter"/><NButton type="primary" block class="modal-button" @click="enter">进入直播间</NButton></NCard></NModal>
</NMessageProvider></NDialogProvider></NConfigProvider></template>
