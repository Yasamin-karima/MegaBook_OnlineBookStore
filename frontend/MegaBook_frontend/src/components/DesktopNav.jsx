import React from 'react'
import { NavLink, Link, useLocation } from 'react-router-dom'
import { LuShoppingCart, LuLibrary, LuUser, LuStore, LuBell, LuLogIn, LuCircleUser } from 'react-icons/lu'
import { PiSwap } from 'react-icons/pi'
import logo from '../assets/logo.svg'
import { isLoggedIn } from '../api/auth'
import useCart from '../hooks/useCart'

// The desktop version of BottomNavbar: the same five destinations, as a side bar on the
// right (RTL start). Hidden below md, where BottomNavbar (home page) takes over.
// md: a narrow icon rail (w-20); lg: a full sidebar with labels beside the icons (w-60).
// AppLayout (App.jsx) pads the page by the same width so nothing sits under it.
const LINKS = [
    { to: '/', label: 'فروشگاه', Icon: LuStore, end: true },
    { to: '/library', label: 'کتابخانه شخصی', Icon: LuLibrary },
    { to: '/requests', label: 'مبادله', Icon: PiSwap },
    { to: '/cart', label: 'سبد خرید', Icon: LuShoppingCart, badge: true },
    { to: '/dashboard', label: 'داشبورد', Icon: LuUser },
]

// Shared by every item; NavLink adds aria-current="page" to the active one by itself
const itemClass = ({ isActive }) =>
    `relative flex flex-col items-center gap-1 rounded-2xl px-1 py-2 text-xs transition-colors lg:flex-row lg:gap-3 lg:px-4 lg:py-2.5 lg:text-sm
     focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4c687c] focus-visible:ring-offset-2 focus-visible:ring-offset-[#f9fcfc]
     ${isActive ? 'bg-[#4c687c] font-semibold text-white' : 'text-gray-500 hover:bg-gray-100 hover:text-[#4c687c]'}`

const DesktopNav = () => {
    // Re-render on every navigation, so login/logout shows up in the account item
    useLocation()
    const loggedIn = isLoggedIn()
    // The same count as every other cart badge (CartProvider)
    const { count } = useCart()

    return (
        <aside className="fixed inset-y-0 start-0 z-20 hidden w-20 flex-col border-e border-gray-200 bg-[#f9fcfc] md:flex lg:w-60">
            <Link
                to="/"
                aria-label="مگابوک، صفحه اصلی"
                className="flex h-16 shrink-0 items-center justify-center rounded-2xl focus:outline-none focus-visible:ring-2 focus-visible:ring-[#4c687c] lg:justify-start lg:px-4"
            >
                <img src={logo} alt="" className="w-16 lg:w-[150px]" />
            </Link>

            <nav aria-label="منوی اصلی" className="flex flex-1 flex-col gap-1 px-2 pt-2 lg:px-3">
                {LINKS.map(({ to, label, Icon, end, badge }) => (
                    <NavLink key={to} to={to} end={end} className={itemClass}>
                        <Icon className="shrink-0 text-2xl lg:text-xl" aria-hidden="true" />
                        <span className="text-center leading-4 lg:text-start lg:leading-normal">{label}</span>
                        {badge && count > 0 && (
                            <span className="absolute top-1 end-3 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white lg:static lg:ms-auto">
                                {count.toLocaleString('fa-IR')}
                                <span className="sr-only"> کتاب در سبد</span>
                            </span>
                        )}
                    </NavLink>
                ))}
            </nav>

            <div className="flex flex-col gap-1 border-t border-gray-200 px-2 py-3 lg:px-3">
                <a href="#" className={itemClass({ isActive: false })}>
                    <LuBell className="shrink-0 text-2xl lg:text-xl" aria-hidden="true" />
                    <span>اعلان‌ها</span>
                </a>
                {/* Logged in: the account page; otherwise the login page */}
                <NavLink to={loggedIn ? '/account' : '/login'} className={itemClass}>
                    {loggedIn
                        ? <LuCircleUser className="shrink-0 text-2xl lg:text-xl" aria-hidden="true" />
                        : <LuLogIn className="shrink-0 text-2xl lg:text-xl" aria-hidden="true" />}
                    <span>{loggedIn ? 'حساب' : 'ورود'}</span>
                </NavLink>
            </div>
        </aside>
    )
}

export default DesktopNav
