import supabase from './supabase'

const API_URL = import.meta.env.VITE_API_URL

/** fetch() against growth_os_server with the signed-in user's Supabase access token attached. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const { data: { session } } = await supabase.auth.getSession()
  const headers = new Headers(init.headers)
  if (session) headers.set('Authorization', `Bearer ${session.access_token}`)
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  return fetch(`${API_URL}${path}`, { ...init, headers })
}
