import React from 'react'
import { Link } from 'react-router-dom'
import { LuBell } from 'react-icons/lu'
import logo from '../assets/logo.svg'
import { isLoggedIn } from '../api/auth'
import useNotifications from '../hooks/useNotifications'
import { UnreadBadge } from './NotificationsPage'

const Navbar = () => {
    const loggedIn = isLoggedIn()
    // The same count as the desktop bell (NotificationsProvider)
    const { unread } = useNotifications()
    return (
        <nav className="flex md:hidden z-10 justify-between fixed inset-x-0 top-0 h-16 bg-[#f9fcfc] rounded-3xl">
            <div className="flex items-center pr-4">
                <img src={logo} className='block-20 justify-end' />
            </div>
            <div className="flex justify-around items-center px-4 gap-3">
                {/* A guest is sent to /login by the protected route */}
                <Link to='/notifications' aria-label='اعلان‌ها' className='relative'>
                    <LuBell className='text-2xl text-[#4c687c]' />
                    <UnreadBadge count={loggedIn ? unread : 0} className='absolute -top-2 -end-2' />
                </Link>
                {/* Logged in: link to the account page instead of the login page */}
                <Link
                    to={loggedIn ? '/account' : '/login'}
                    className='bg-[#4c687c] rounded-2xl w-12 h-8 flex justify-center text-white'
                >
                    {loggedIn ? 'حساب' : 'ورود'}
                </Link>
            </div>
        </nav>
    )
}

export default Navbar