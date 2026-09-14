import { createRouter, createWebHistory } from 'vue-router';
import HomeView from './views/HomeView.vue';
import AuthView from './views/AuthView.vue';
import RoomView from './views/RoomView.vue';
import MyRoomView from './views/MyRoomView.vue';
import ReplaysView from './views/ReplaysView.vue';
import ProfileView from './views/ProfileView.vue';
import AdminView from './views/AdminView.vue';
export default createRouter({ history:createWebHistory(), routes:[
  {path:'/',component:HomeView},{path:'/categories/:slug?',component:HomeView},{path:'/search',component:HomeView},{path:'/replays',component:ReplaysView},{path:'/room/:roomNumber',component:RoomView},
  {path:'/login',component:AuthView,props:{mode:'login'}},{path:'/register',component:AuthView,props:{mode:'register'}},{path:'/forgot-password',component:AuthView,props:{mode:'forgot'}},
  {path:'/me',component:ProfileView},{path:'/me/security',component:ProfileView},{path:'/me/room',component:MyRoomView},{path:'/me/stream',component:MyRoomView},{path:'/me/sessions',component:MyRoomView},{path:'/admin/:section?',component:AdminView}
]});
