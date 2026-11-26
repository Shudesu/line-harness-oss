'use client'
import { useEffect, useState } from 'react'
/** UI affordance only; the Worker remains the authorization boundary. */
export function useStaffCanManage(): boolean {
  const [allowed, setAllowed] = useState(false)
  useEffect(() => {
    const update = () => {
      const role = localStorage.getItem('lh_staff_role')
      const policy = localStorage.getItem('lh_staff_policy')
      setAllowed(role === 'owner' || role === 'admin' || (role === 'staff' && policy !== 'strict'))
    }
    update()
    window.addEventListener('lh-auth-updated', update)
    window.addEventListener('storage', update)
    return () => { window.removeEventListener('lh-auth-updated', update); window.removeEventListener('storage', update) }
  }, [])
  return allowed
}
