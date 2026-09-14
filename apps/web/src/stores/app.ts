import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import { api } from '../api';
type User = { id:string; username:string; nickname:string; avatar?:string; email?:string; roles:string[]; canStream:boolean };
export const useAppStore = defineStore('app', () => {
  const settings = ref<Record<string, unknown>>({ 'site.name': 'XLive' }); const user = ref<User | null>(null); const loaded = ref(false);
  const isAdmin = computed(() => user.value?.roles.some(r => r === 'ADMIN' || r === 'SUPER_ADMIN') ?? false);
  async function bootstrap() { try { settings.value = (await api<{data:Record<string,unknown>}>('/api/settings/public')).data; document.title = String(settings.value['site.name'] ?? 'XLive'); const favicon = String(settings.value['site.favicon'] ?? ''); if (favicon) { let el = document.querySelector<HTMLLinkElement>('link[rel="icon"]'); if (!el) { el = document.createElement('link'); el.rel='icon'; document.head.append(el); } el.href=favicon; } try { user.value = (await api<{data:User}>('/api/users/me')).data; } catch { user.value=null; } } finally { loaded.value=true; } }
  async function login(account:string,password:string){ user.value=(await api<{data:User}>('/api/auth/login',{method:'POST',body:JSON.stringify({account,password})})).data; }
  async function logout(){ await api('/api/auth/logout',{method:'POST'}); user.value=null; }
  return { settings,user,loaded,isAdmin,bootstrap,login,logout };
});
