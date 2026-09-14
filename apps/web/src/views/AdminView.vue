<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api } from '../api';
import { useAppStore } from '../stores/app';

const route = useRoute();
const router = useRouter();
const store = useAppStore();
const section = computed(() => String(route.params.section ?? 'dashboard'));
const isSuperAdmin = computed(() => store.user?.roles.includes('SUPER_ADMIN') ?? false);
const error = ref('');
const notice = ref('');
const loading = ref(false);
const busy = ref(false);
const data = ref<any>([]);
const health = ref<Record<string, { status: string }>>({});
const search = ref('');
const settings = reactive<Record<string, any>>({});
const test = reactive({ email: '', phone: '' });
const categoryForm = reactive({ id: 0, name: '', slug: '', icon: '', sort: 0, enabled: true });
const adminForm = reactive({ username: '', nickname: '', email: '', password: '', role: 'ADMIN' });
const allNav = [['dashboard', '仪表盘'], ['users', '用户管理'], ['notices', '开播申请'], ['rooms', '直播管理'], ['sessions', '直播记录'], ['replays', '回放管理'], ['categories', '分类管理'], ['messages', '消息管理'], ['files', '文件管理'], ['logs', '系统日志'], ['basic', '基础设置'], ['register', '注册设置'], ['smtp', '邮件设置'], ['sms', '短信设置'], ['password', '密码策略'], ['live', '直播设置'], ['security', '安全设置'], ['admins', '管理员管理']];
const nav = computed(() => allNav.filter(item => item[0] !== 'admins' || isSuperAdmin.value));
const settingSections = ['basic', 'register', 'smtp', 'sms', 'password', 'live', 'security'];
const filteredData = computed(() => {
  const rows = Array.isArray(data.value) ? data.value : [];
  const query = search.value.trim().toLowerCase();
  return query ? rows.filter((row: any) => JSON.stringify(row).toLowerCase().includes(query)) : rows;
});

function messageOf(value: unknown) { return value instanceof Error ? value.message : '操作失败，请稍后再试'; }
function flash(message: string) {
  notice.value = message;
  window.setTimeout(() => { if (notice.value === message) notice.value = ''; }, 3500);
}
async function load() {
  loading.value = true; error.value = ''; search.value = '';
  try {
    if (section.value === 'dashboard') {
      const [dashboard, status] = await Promise.all([
        api<{ data: Record<string, any> }>('/api/admin/dashboard'),
        api<{ data: Record<string, { status: string }> }>('/api/admin/health')
      ]);
      data.value = dashboard.data; health.value = status.data;
    } else if (['users', 'notices', 'rooms', 'sessions', 'replays', 'messages', 'files', 'categories', 'logs', 'admins'].includes(section.value)) {
      data.value = (await api<{ data: any[] }>(`/api/admin/${section.value}${section.value === 'users' ? '?limit=100' : ''}`)).data;
    } else if (settingSections.includes(section.value)) {
      Object.assign(settings, (await api<{ data: Record<string, unknown> }>('/api/admin/settings')).data);
    } else await router.replace('/admin/dashboard');
  } catch (value) { error.value = messageOf(value); }
  finally { loading.value = false; }
}
async function action(path: string, method = 'POST', body?: object, success = '操作成功') {
  busy.value = true; error.value = '';
  try {
    await api(path, { method, body: body ? JSON.stringify(body) : undefined });
    flash(success); await load(); return true;
  } catch (value) { error.value = messageOf(value); return false; }
  finally { busy.value = false; }
}
async function confirmAction(message: string, path: string, method = 'POST', body?: object, success?: string) {
  if (window.confirm(message)) await action(path, method, body, success);
}
async function saveSettings() {
  if (!isSuperAdmin.value) return;
  busy.value = true; error.value = '';
  try {
    const result = await api<{ data: Record<string, unknown> }>('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ values: settings }) });
    Object.assign(settings, result.data); flash('设置已保存，将在 30 秒缓存窗口内全站生效');
  } catch (value) { error.value = messageOf(value); }
  finally { busy.value = false; }
}
async function testService(type: 'smtp' | 'sms') {
  await action(`/api/admin/settings/${type}/test`, 'POST', type === 'smtp' ? { email: test.email } : { phone: test.phone }, type === 'smtp' ? '测试邮件已发送' : '测试短信已发送');
}
async function resetPassword(user: any) {
  const password = window.prompt(`为 ${user.nickname} 设置新密码（需满足当前密码策略）`);
  if (password) await action(`/api/admin/users/${user.id}/reset-password`, 'POST', { password }, '密码已重置，该用户的其他登录会话已退出');
}
async function muteUser(user: any) {
  const raw = window.prompt(`禁言 ${user.nickname} 多少分钟？`, '60'); if (!raw) return;
  const minutes = Number(raw);
  if (Number.isInteger(minutes) && minutes > 0) await action(`/api/admin/users/${user.id}/chat-ban`, 'POST', { minutes }, `已禁言 ${minutes} 分钟`);
  else error.value = '请输入有效的禁言分钟数';
}
async function renameUser(user: any) {
  const nickname = window.prompt('输入新的用户昵称', user.nickname); if (!nickname || nickname === user.nickname) return;
  await action(`/api/admin/users/${user.id}`, 'PATCH', { nickname }, '用户昵称已更新');
}
function editCategory(category: any) { Object.assign(categoryForm, { id: category.id, name: category.name, slug: category.slug, icon: category.icon ?? '', sort: category.sort, enabled: category.enabled }); }
function clearCategory() { Object.assign(categoryForm, { id: 0, name: '', slug: '', icon: '', sort: 0, enabled: true }); }
async function saveCategory() {
  const body = { name: categoryForm.name.trim(), slug: categoryForm.slug.trim(), icon: categoryForm.icon.trim() || undefined, sort: categoryForm.sort, enabled: categoryForm.enabled };
  const ok = categoryForm.id ? await action(`/api/admin/categories/${categoryForm.id}`, 'PATCH', body, '分类已更新') : await action('/api/admin/categories', 'POST', body, '分类已创建');
  if (ok) clearCategory();
}
async function createAdmin() {
  const ok = await action('/api/admin/admins', 'POST', { ...adminForm }, '管理员已创建');
  if (ok) Object.assign(adminForm, { username: '', nickname: '', email: '', password: '', role: 'ADMIN' });
}
function formatDuration(value?: number) {
  if (value == null) return '-'; const hours = Math.floor(value / 3600), minutes = Math.floor(value % 3600 / 60), seconds = value % 60;
  return [hours ? `${hours}时` : '', minutes ? `${minutes}分` : '', `${seconds}秒`].join('');
}
function formatBytes(value?: number | string | null) {
  if (value == null) return '-'; const bytes = Number(value); if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB']; const i = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  return `${(bytes / 1024 ** i).toFixed(i ? 1 : 0)} ${units[i]}`;
}

onMounted(async () => { if (!store.user) await store.bootstrap(); if (!store.isAdmin) { await router.replace('/login'); return; } await load(); });
watch(section, async () => { if (section.value === 'admins' && !isSuperAdmin.value) { await router.replace('/admin/dashboard'); return; } await load(); });
</script>

<template>
  <div class="sidebar-layout admin-layout">
    <aside class="panel sidebar">
      <strong class="sidebar-title">管理后台</strong>
      <router-link v-for="item in nav" :key="item[0]" :to="`/admin/${item[0]}`">{{ item[1] }}</router-link>
    </aside>
    <section class="admin-content">
      <div class="admin-toolbar">
        <div><h1>{{ nav.find(item => item[0] === section)?.[1] }}</h1><p class="muted">所有操作均直接连接后台服务。</p></div>
        <button class="button" :disabled="loading" @click="load">{{ loading ? '加载中…' : '刷新数据' }}</button>
      </div>
      <p v-if="error" class="panel error">{{ error }}</p><p v-if="notice" class="panel success">{{ notice }}</p>
      <div v-if="loading" class="panel empty">正在读取后台数据…</div>

      <template v-else-if="section === 'dashboard' && data.metrics">
        <div class="metric-grid"><div v-for="(value,key) in data.metrics" :key="key" class="metric"><span class="muted">{{ ({users:'用户总数',todayUsers:'今日新增',live:'正在直播',rooms:'房间总数',todaySessions:'今日直播',viewers:'在线观众'} as any)[key] ?? key }}</span><h2>{{ value }}</h2></div></div>
        <div class="admin-two-col">
          <div class="panel"><h2>服务健康</h2><div class="health-list"><div v-for="(value,key) in health" :key="key"><span>{{ ({application:'应用服务',database:'数据库',redis:'Redis',mediaServer:'媒体服务',smtp:'邮件服务',sms:'短信服务'} as any)[key] ?? key }}</span><span class="status-dot" :class="{'status-ok':value.status === '正常' || value.status === '已配置'}">{{ value.status }}</span></div></div></div>
          <div class="panel"><h2>运行环境</h2><p>Node {{ data.system.node }} · {{ data.system.platform }}</p><p>运行 {{ formatDuration(data.system.uptimeSeconds) }}</p><p>CPU {{ data.system.cpuUsage }}% · 内存 {{ Math.round(data.system.memory.used/1024/1024) }} / {{ Math.round(data.system.memory.total/1024/1024) }} MB</p><p class="muted">PostgreSQL {{ data.system.postgres }}<br>Redis {{ data.system.redis }} · 媒体服务器 {{ data.system.mediaServer }}</p></div>
        </div>
      </template>

      <template v-else-if="['users','notices','rooms','sessions','replays','messages','files','logs'].includes(section)">
        <div class="panel"><div class="list-toolbar"><input v-model="search" class="input" placeholder="搜索当前列表"><span class="muted">共 {{ filteredData.length }} 条</span></div><div class="table-wrap">
          <table v-if="section === 'users'" class="data-table"><thead><tr><th>用户</th><th>邮箱 / 手机</th><th>状态</th><th>直播</th><th>注册 / 登录</th><th>操作</th></tr></thead><tbody><tr v-for="user in filteredData" :key="user.id"><td><strong>{{ user.nickname }}</strong><br><small>{{ user.username }} · {{ user.roles.map((role:any)=>role.role.name).join(', ') }}</small></td><td>{{ user.email || '-' }}<br>{{ user.phone || '-' }}</td><td><span class="tag" :class="{'tag-ok':user.status==='ACTIVE'}">{{ user.status }}</span><br><small v-if="user.bans?.length" class="error">已禁言至 {{ user.bans[0].expiresAt?new Date(user.bans[0].expiresAt).toLocaleString():'永久' }}</small></td><td>{{ user.canStream ? '允许' : '禁止' }}</td><td><small>{{ new Date(user.createdAt).toLocaleString() }}<br>{{ user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString() : '从未登录' }}</small></td><td><div class="actions"><button class="button small" :disabled="busy" @click="action(`/api/admin/users/${user.id}`,'PATCH',{status:user.status==='ACTIVE'?'DISABLED':'ACTIVE'})">{{ user.status==='ACTIVE'?'禁用':'启用' }}</button><button class="button small" @click="action(`/api/admin/users/${user.id}`,'PATCH',{canStream:!user.canStream})">{{ user.canStream?'禁播':'恢复直播' }}</button><button v-if="user.bans?.length" class="button small" @click="action(`/api/admin/bans/${user.bans[0].id}`,'DELETE',undefined,'禁言已解除')">解除禁言</button><button v-else class="button small" @click="muteUser(user)">禁言</button><button class="button small" @click="renameUser(user)">改昵称</button><button class="button small" @click="resetPassword(user)">重置密码</button><button v-if="isSuperAdmin && user.id !== store.user?.id" class="button small danger" @click="confirmAction(`确认删除用户 ${user.nickname}？`,`/api/admin/users/${user.id}`,'DELETE',undefined,'用户已删除')">删除</button></div></td></tr></tbody></table>
          <table v-else-if="section === 'notices'" class="data-table"><thead><tr><th>申请人</th><th>申请内容</th><th>时间</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="n in filteredData" :key="n.id"><td>{{ n.from.nickname }}<br><small>{{ n.from.username }}</small></td><td>{{ n.content }}</td><td>{{ new Date(n.createdAt).toLocaleString() }}</td><td><span class="tag" :class="{'tag-ok':n.status==='APPROVED'}">{{ ({PENDING:'待审核',APPROVED:'已批准',REJECTED:'已拒绝'} as any)[n.status] ?? n.status }}</span></td><td><div class="actions"><button v-if="n.status==='PENDING'" class="button small" @click="action(`/api/admin/notices/${n.id}/approve`,'POST',undefined,'已批准开播权限')">批准开播</button><button v-if="n.status==='PENDING'" class="button small danger" @click="confirmAction('确认拒绝该申请？',`/api/admin/notices/${n.id}/reject`,'POST',undefined,'已拒绝申请')">拒绝</button></div></td></tr></tbody></table>
          <table v-else-if="section === 'rooms'" class="data-table"><thead><tr><th>房间</th><th>主播</th><th>可见性</th><th>状态</th><th>观看</th><th>操作</th></tr></thead><tbody><tr v-for="room in filteredData" :key="room.id"><td><router-link class="table-link" :to="`/room/${room.roomNumber}`">{{ room.roomNumber }} · {{ room.title }}</router-link><br><small v-if="room.featured" class="success">首页推荐</small></td><td>{{ room.owner.nickname }}</td><td>{{ room.visibility }}</td><td><span class="tag" :class="{'tag-ok':room.streamStatus==='LIVE'}">{{ room.streamStatus }}</span></td><td>{{ room.viewerCount }}</td><td><div class="actions"><button class="button small" @click="action(`/api/admin/rooms/${room.roomNumber}`,'PATCH',{featured:!room.featured},room.featured?'已取消推荐':'已设为推荐')">{{ room.featured?'取消推荐':'推荐' }}</button><button class="button small" @click="action(`/api/admin/rooms/${room.roomNumber}`,'PATCH',{visibility:room.visibility==='PUBLIC'?'PRIVATE':'PUBLIC'})">设为{{ room.visibility==='PUBLIC'?'私密':'公开' }}</button><button class="button small" :disabled="room.streamStatus!=='LIVE'" @click="confirmAction('确认强制断开这场直播？',`/api/admin/rooms/${room.roomNumber}/stop`)">断流</button><button class="button small" @click="confirmAction('确认更改该房间的直播权限？',`/api/admin/rooms/${room.roomNumber}/${room.liveBanned?'unban':'ban'}`)">{{ room.liveBanned?'恢复':'封禁' }}</button><button class="button small danger" @click="confirmAction('删除房间后直播记录和聊天消息也会删除，确认继续？',`/api/admin/rooms/${room.roomNumber}`,'DELETE',undefined,'直播间已删除')">删除</button></div></td></tr></tbody></table>
          <table v-else-if="section === 'sessions'" class="data-table"><thead><tr><th>房间</th><th>主播</th><th>开始</th><th>结束</th><th>时长</th><th>峰值 / 浏览</th><th>回放</th></tr></thead><tbody><tr v-for="session in filteredData" :key="session.id"><td>{{ session.room.roomNumber }} · {{ session.room.title }}</td><td>{{ session.room.owner.nickname }}</td><td>{{ new Date(session.startedAt).toLocaleString() }}</td><td>{{ session.endedAt?new Date(session.endedAt).toLocaleString():'直播中' }}</td><td>{{ formatDuration(session.durationSeconds) }}</td><td>{{ session.peakViewers }} / {{ session.totalViews }}</td><td><a v-if="session.recordingUrl" class="table-link" :href="session.recordingUrl" target="_blank">打开回放</a><span v-else class="muted">未生成</span></td></tr></tbody></table>
          <table v-else-if="section === 'messages'" class="data-table"><thead><tr><th>房间</th><th>用户</th><th>内容</th><th>时间</th><th>操作</th></tr></thead><tbody><tr v-for="message in filteredData" :key="message.id"><td>{{ message.room.roomNumber }}</td><td>{{ message.nickname }}</td><td :class="{muted:message.deletedAt}">{{ message.deletedAt?'[已删除]':message.content }}</td><td>{{ new Date(message.createdAt).toLocaleString() }}</td><td><button v-if="!message.deletedAt" class="button small danger" @click="confirmAction('确认删除这条消息？',`/api/admin/messages/${message.id}`,'DELETE')">删除</button></td></tr></tbody></table>
          <table v-else-if="section === 'replays'" class="data-table"><thead><tr><th>房间</th><th>主播</th><th>开始</th><th>时长</th><th>大小</th><th>操作</th></tr></thead><tbody><tr v-for="session in filteredData" :key="session.id"><td>{{ session.room.roomNumber }} · {{ session.room.title }}</td><td>{{ session.room.owner.nickname }}</td><td>{{ new Date(session.startedAt).toLocaleString() }}</td><td>{{ formatDuration(session.durationSeconds) }}</td><td>{{ formatBytes(session.recordingSize) }}</td><td><div class="actions"><a class="button small" :href="`/api/admin/replays/${session.id}/download`">下载</a><a v-if="session.recordingUrl" class="button small" :href="session.recordingUrl" target="_blank">打开</a><button class="button small danger" @click="confirmAction('确认删除该回放？删除后观众将无法观看。',`/api/admin/replays/${session.id}`,'DELETE',undefined,'回放已删除')">删除</button></div></td></tr></tbody></table>
          <table v-else-if="section === 'files'" class="data-table"><thead><tr><th>文件</th><th>上传者</th><th>大小</th><th>时间</th><th>操作</th></tr></thead><tbody><tr v-for="file in filteredData" :key="file.id"><td><div class="file-cell"><img v-if="file.mimeType?.startsWith('image/')" class="file-thumb" :src="file.url" :alt="file.originalName||file.filename"><div><a class="table-link" :href="file.url" target="_blank">{{ file.originalName || file.filename }}</a><br><small class="muted">{{ file.mimeType }} · {{ file.url }}</small></div></div></td><td>{{ file.uploader?.nickname || '-' }}</td><td>{{ formatBytes(file.size) }}</td><td>{{ new Date(file.createdAt).toLocaleString() }}</td><td><div class="actions"><a class="button small" :href="`/api/admin/files/${file.id}/download`">下载</a><button class="button small danger" @click="confirmAction('确认删除该文件？使用它的头像/封面将失效。',`/api/admin/files/${file.id}`,'DELETE',undefined,'文件已删除')">删除</button></div></td></tr></tbody></table>
          <table v-else class="data-table"><thead><tr><th>时间</th><th>管理员</th><th>操作</th><th>对象</th><th>结果</th><th>IP</th></tr></thead><tbody><tr v-for="log in filteredData" :key="log.id"><td>{{ new Date(log.createdAt).toLocaleString() }}</td><td>{{ log.admin.nickname }}</td><td>{{ log.action }}</td><td>{{ log.targetType || '-' }} {{ log.targetId || '' }}</td><td>{{ log.result }}</td><td>{{ log.ip || '-' }}</td></tr></tbody></table>
        </div></div>
      </template>

      <template v-else-if="section === 'categories'"><div class="admin-two-col category-layout">
        <form class="panel form" @submit.prevent="saveCategory"><h2>{{ categoryForm.id?'编辑分类':'新增分类' }}</h2><label>名称<input v-model="categoryForm.name" class="input" required maxlength="64"></label><label>英文标识<input v-model="categoryForm.slug" class="input" required pattern="[a-z0-9-]+" placeholder="例如 technology"></label><label>图标标识<input v-model="categoryForm.icon" class="input"></label><label>排序<input v-model.number="categoryForm.sort" type="number" class="input"></label><label><span><input v-model="categoryForm.enabled" type="checkbox"> 启用</span></label><div class="actions"><button class="button primary-button" :disabled="busy">{{ categoryForm.id?'保存修改':'创建分类' }}</button><button v-if="categoryForm.id" type="button" class="button" @click="clearCategory">取消</button></div></form>
        <div class="panel table-wrap"><table class="data-table"><thead><tr><th>分类</th><th>标识</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="category in data" :key="category.id"><td>{{ category.name }}</td><td>{{ category.slug }}</td><td>{{ category.sort }}</td><td>{{ category.enabled?'启用':'禁用' }}</td><td><div class="actions"><button class="button small" @click="editCategory(category)">编辑</button><button class="button small" @click="action(`/api/admin/categories/${category.id}`,'PATCH',{enabled:!category.enabled})">{{ category.enabled?'停用':'启用' }}</button><button class="button small danger" @click="confirmAction('确认删除该分类？',`/api/admin/categories/${category.id}`,'DELETE')">删除</button></div></td></tr></tbody></table></div>
      </div></template>

      <template v-else-if="section === 'admins'"><div class="admin-two-col category-layout">
        <form class="panel form" @submit.prevent="createAdmin"><h2>新增管理员</h2><label>用户名<input v-model="adminForm.username" class="input" minlength="3" required></label><label>昵称<input v-model="adminForm.nickname" class="input" required></label><label>邮箱<input v-model="adminForm.email" type="email" class="input" required></label><label>初始密码<input v-model="adminForm.password" type="password" class="input" required></label><label>角色<select v-model="adminForm.role" class="input"><option value="ADMIN">管理员</option><option value="SUPER_ADMIN">超级管理员</option></select></label><button class="button primary-button" :disabled="busy">创建管理员</button></form>
        <div class="panel table-wrap"><table class="data-table"><thead><tr><th>管理员</th><th>邮箱</th><th>角色</th><th>状态</th><th>操作</th></tr></thead><tbody><tr v-for="user in data" :key="user.id"><td>{{ user.nickname }}<br><small>{{ user.username }}</small></td><td>{{ user.email }}</td><td>{{ user.roles.map((role:any)=>role.role.name).join(', ') }}</td><td>{{ user.status }}</td><td><div v-if="user.id!==store.user?.id" class="actions"><button class="button small" @click="action(`/api/admin/users/${user.id}`,'PATCH',{status:user.status==='ACTIVE'?'DISABLED':'ACTIVE'})">{{ user.status==='ACTIVE'?'禁用':'启用' }}</button><button class="button small" @click="action(`/api/admin/admins/${user.id}/role`,'PATCH',{role:user.roles.some((item:any)=>item.role.name==='SUPER_ADMIN')?'ADMIN':'SUPER_ADMIN'},'管理员角色已更新')">设为{{ user.roles.some((item:any)=>item.role.name==='SUPER_ADMIN')?'管理员':'超级管理员' }}</button></div><span v-else class="muted">当前账号</span></td></tr></tbody></table></div>
      </div></template>

      <template v-else-if="settingSections.includes(section)"><div class="panel settings-panel"><div v-if="!isSuperAdmin" class="readonly-note">当前账号可以查看设置，但只有超级管理员可以修改。</div><form class="form" @submit.prevent="saveSettings">
        <template v-if="section === 'basic'"><label>站点名称<input v-model="settings['site.name']" class="input"></label><label>站点副标题<input v-model="settings['site.subtitle']" class="input"></label><label>站点描述<textarea v-model="settings['site.description']" class="input"></textarea></label><label>搜索关键词<input v-model="settings['site.keywords']" class="input"></label><label>Logo URL<input v-model="settings['site.logo']" class="input"></label><label>Dark Logo URL<input v-model="settings['site.darkLogo']" class="input"></label><label>Favicon URL<input v-model="settings['site.favicon']" class="input"></label><label>ICP备案文字<input v-model="settings['site.icp.text']" class="input"></label><label>ICP备案链接<input v-model="settings['site.icp.url']" class="input"></label><label>公安备案文字<input v-model="settings['site.police.text']" class="input"></label><label>公安备案链接<input v-model="settings['site.police.url']" class="input"></label><label>页脚文字<input v-model="settings['site.footer']" class="input"></label><label>版权信息<input v-model="settings['site.copyright']" class="input"></label><label>用户协议<textarea v-model="settings['site.userAgreement']" class="input" rows="10"></textarea><small>注册时弹窗展示，需滚动到底部才能勾选同意。</small></label></template>
        <template v-else-if="section === 'register'"><label><span><input v-model="settings['auth.register.email']" type="checkbox"> 邮箱注册</span></label><label><span><input v-model="settings['auth.register.sms']" type="checkbox"> 手机号注册</span></label><label>验证规则<select v-model="settings['auth.register.rule']" class="input"><option value="ANY">任意一种</option><option value="ALL">两者都必须</option></select></label><label><span><input v-model="settings['auth.register.requireVerification']" type="checkbox"> 注册必须验证码</span></label></template>
        <template v-else-if="section === 'smtp'"><label>SMTP Host<input v-model="settings['smtp.host']" class="input"></label><label>Port<input v-model.number="settings['smtp.port']" type="number" class="input"></label><label>Username<input v-model="settings['smtp.username']" class="input"></label><label>Password<input v-model="settings['smtp.password']" type="password" class="input" placeholder="留空保持不变"></label><label>Encryption<select v-model="settings['smtp.encryption']" class="input"><option>NONE</option><option>SSL</option><option>STARTTLS</option></select></label><label>发件人邮箱<input v-model="settings['smtp.fromEmail']" class="input"></label><label>发件人名称<input v-model="settings['smtp.fromName']" class="input"></label><label>测试收件箱<div class="search"><input v-model="test.email" type="email" class="input"><button type="button" class="button" :disabled="!isSuperAdmin||!test.email" @click="testService('smtp')">发送测试邮件</button></div></label></template>
        <template v-else-if="section === 'sms'"><label>AccessKey ID<input v-model="settings['sms.accessKeyId']" class="input"></label><label>AccessKey Secret<input v-model="settings['sms.accessKeySecret']" type="password" class="input" placeholder="留空保持不变"></label><label>短信签名<input v-model="settings['sms.signName']" class="input"></label><label>注册模板 ID<input v-model="settings['sms.registerTemplateId']" class="input"></label><label>登录模板 ID<input v-model="settings['sms.loginTemplateId']" class="input"></label><label>找回密码模板 ID<input v-model="settings['sms.resetTemplateId']" class="input"></label><label>测试手机号<div class="search"><input v-model="test.phone" class="input"><button type="button" class="button" :disabled="!isSuperAdmin||!test.phone" @click="testService('sms')">发送测试短信</button></div></label></template>
        <template v-else-if="section === 'password'"><label>最小长度<input v-model.number="settings['password.policy'].minLength" type="number" min="8" max="128" class="input"></label><label>最大长度<input v-model.number="settings['password.policy'].maxLength" type="number" min="8" max="256" class="input"></label><label><span><input v-model="settings['password.policy'].uppercase" type="checkbox"> 必须包含大写字母</span></label><label><span><input v-model="settings['password.policy'].lowercase" type="checkbox"> 必须包含小写字母</span></label><label><span><input v-model="settings['password.policy'].number" type="checkbox"> 必须包含数字</span></label><label><span><input v-model="settings['password.policy'].special" type="checkbox"> 必须包含特殊字符</span></label></template>
        <template v-else-if="section === 'live'"><label><span><input v-model="settings['live.allowRegisteredUsers']" type="checkbox"> 允许注册用户创建直播间</span></label><label><span><input v-model="settings['live.newUserCanStream']" type="checkbox"> 新用户默认允许直播</span></label><label>最大同时直播数<input v-model.number="settings['live.maxConcurrent']" type="number" min="1" class="input"></label><label>单用户最大直播间数<input v-model.number="settings['live.maxPerUser']" type="number" min="1" class="input"></label><label>最大码率 Kbps<input v-model.number="settings['live.maxBitrateKbps']" type="number" min="1" class="input"></label><label>最大 FPS<input v-model.number="settings['live.maxFps']" type="number" min="1" class="input"></label><label><span><input v-model="settings['live.showPlayerLatency']" type="checkbox"> 播放器显示直播延迟</span></label><label>播放协议<select v-model="settings['live.playback.protocol']" class="input"><option value="FLV">FLV（低延迟，直连源站）</option><option value="HLS">HLS（走 CDN 加速）</option></select></label><label>FLV 直连播放域名<input v-model="settings['live.playback.flvHost']" class="input" placeholder="如 live.example.com，留空则跟随当前访问域名"></label><div class="qblock"><span>转码清晰度列表</span><div v-for="(quality,index) in settings['live.transcode.qualities']" :key="index" class="qrow"><input v-model="quality.label" class="input" placeholder="名称"><input v-model.number="quality.width" type="number" min="1" class="input" placeholder="宽"><span>×</span><input v-model.number="quality.height" type="number" min="1" class="input" placeholder="高"><input v-model.number="quality.bitrate" type="number" min="1" class="input" placeholder="码率"><input v-model.number="quality.fps" type="number" min="1" class="input" placeholder="帧率"><label><span><input v-model="quality.enabled" type="checkbox">启用</span></label><button type="button" class="button" @click="settings['live.transcode.qualities'].splice(index,1)">删除</button></div><button type="button" class="button" @click="settings['live.transcode.qualities'].push({label:'1080P',width:1920,height:1080,bitrate:3000,fps:30,enabled:true})">+ 添加清晰度</button></div></template>
        <template v-else><label><span><input v-model="settings['auth.guestViewing']" type="checkbox"> 允许游客观看</span></label><label>登录失败锁定阈值<input v-model.number="settings['security.loginMaxFailures']" type="number" min="1" class="input"></label><label>锁定分钟数<input v-model.number="settings['security.loginLockMinutes']" type="number" min="1" class="input"></label></template>
        <button class="button primary-button" :disabled="busy||!isSuperAdmin">{{ busy?'保存中…':isSuperAdmin?'保存设置':'仅超级管理员可保存' }}</button>
      </form></div></template>
    </section>
  </div>
</template>
