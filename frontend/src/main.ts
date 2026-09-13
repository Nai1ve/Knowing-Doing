import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import { router } from './router'
import { useAuthStore } from './stores/auth'
import './styles/tokens.css'
import './styles/base.css'
import '@vue-flow/core/dist/style.css'

const pinia = createPinia()
const app = createApp(App).use(pinia).use(router)
// Signed identity must exist before route components issue their first API call.
// Bootstrap failure is non-fatal while the legacy rollout flag remains enabled.
void useAuthStore(pinia).bootstrapSession().finally(() => app.mount('#app'))
