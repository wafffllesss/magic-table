import { createApp } from 'vue'
import App from './App.vue'
import { localRepository } from './services/storage.ts'
import { initializeLocale, i18n } from './i18n/index.ts'
import { migrateLegacyDatabases } from './services/legacyMigration.ts'
import './style.css'

// Show startup feedback while the legacy database migration is running.
if (window.meuMagicDesktop) {
  const shell = document.createElement('main')
  shell.className = 'entry-shell'
  shell.setAttribute('role', 'status')
  shell.setAttribute('aria-busy', 'true')
  const title = document.createElement('h1')
  title.textContent = 'Meu Magic'
  const message = document.createElement('p')
  message.textContent = navigator.language.toLowerCase().startsWith('pt') ? 'Carregando…' : 'Loading…'
  shell.append(title, message)
  document.querySelector('#app')?.replaceChildren(shell)
}

try {
  await migrateLegacyDatabases()
} catch (error) {
  console.error('Meu Magic could not migrate the previous profile.', error)
  const portuguese = navigator.language.toLowerCase().startsWith('pt')
  const shell = document.createElement('main')
  shell.className = 'entry-shell'
  shell.setAttribute('role', 'alert')
  const title = document.createElement('h1')
  title.textContent = 'Meu Magic'
  const message = document.createElement('p')
  message.textContent = portuguese
    ? 'Não foi possível transferir seus dados antigos. Feche a versão anterior do app e tente novamente.'
    : 'Your previous data could not be transferred. Close the older app version and try again.'
  const retry = document.createElement('button')
  retry.className = 'button button-primary'
  retry.textContent = portuguese ? 'Tentar novamente' : 'Try again'
  retry.addEventListener('click', () => window.location.reload())
  shell.append(title, message, retry)
  document.querySelector('#app')?.replaceChildren(shell)
  throw error
}
const preference = await localRepository.getPreference('language-preference')
initializeLocale(preference, navigator.languages?.length ? navigator.languages : [navigator.language])
createApp(App).use(i18n).mount('#app')
