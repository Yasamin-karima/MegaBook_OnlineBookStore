import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import { LuBell, LuShieldCheck } from 'react-icons/lu'
import logo from '../assets/logo.svg'
import { isLoggedIn } from '../api/auth'
import useNotifications from '../hooks/useNotifications'
import useIsStaff from '../hooks/useIsStaff'
import { UnreadBadge } from './NotificationsPage'

// The mobile top bar (below md), on every store page (AppLayout in App.jsx).
// z-30: above the pages' own z-10 / z-20 layers while they scroll under it.
const Navbar = () => {
    // It stays mounted across pages: re-render on every navigation, so login/logout shows up
    useLocation()
    const loggedIn = isLoggedIn()
    // The same count as the desktop bell (NotificationsProvider)
    const { unread } = useNotifications()
    const isStaff = useIsStaff()
    return (
        <nav className="flex md:hidden z-30 justify-between fixed inset-x-0 top-0 h-16 bg-[#f9fcfc] rounded-3xl">
            {/* The logo is the way home from any page */}
            <Link to='/' aria-label='مگابوک، صفحه اصلی' className="flex items-center pr-4">
                <img src={logo} alt='' className='block-20 justify-end' />
            </Link>
            <div className="flex justify-around items-center px-4 gap-3">
                {/* Admins only: straight into the admin dashboard */}
                {isStaff && (
                    <Link
                        to='/admin'
                        className='flex h-8 items-center gap-1 rounded-2xl bg-gray-900 px-2.5 text-sm text-white'
                    >
                        <LuShieldCheck className='text-base' aria-hidden='true' />
                        مدیریت
                    </Link>
                )}
                {/* A guest is sent to /login by the protected route */}
                <Link to='/notifications' aria-label='اعلان‌ها' className='relative'>
                    <LuBell className='text-2xl text-[#4c687c]' />
                    <UnreadBadge count={loggedIn ? unread : 0} className='absolute -top-2 -end-2' />
                </Link>
                {/* Logged in: link to the account page instead of the login page */}
                <Link
                    to={loggedIn ? '/account' : '/login'}
                    className='bg-[#4c687c] rounded-2xl w-12 h-8 flex items-center justify-center text-white'
                >
                    {loggedIn ? 'حساب' : 'ورود'}
                </Link>
            </div>
        </nav>
    )
}

export default Navbar