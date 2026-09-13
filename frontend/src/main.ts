import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import './styles/tokens.css'
import './styles/base.css'
import '@vue-flow/core/dist/style.css'

const pinia = createPinia()
createApp(App).use(pinia).use(router).mount('#app')
void useAuthStore(pinia).bootstrapSession()
