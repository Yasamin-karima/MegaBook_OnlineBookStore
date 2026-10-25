import React from 'react'
import { NavLink } from 'react-router-dom'
import useCart from '../hooks/useCart'
import { LuShoppingCart, LuLibrary, LuUser, LuStore } from 'react-icons/lu'
import { PiSwap } from 'react-icons/pi'

// The mobile bottom bar (below md), on every store page (AppLayout in App.jsx).
// The same five destinations as DesktopNav; NavLink marks the current one
// (aria-current="page" and the darker colour).
// z-30: above the pages' own z-10 / z-20 layers (e.g. the book cards' cart button) while they scroll under it.
const LINKS = [
    { to: '/dashboard', label: 'داشبورد', Icon: LuUser },
    { to: '/cart', label: 'سبد خرید', Icon: LuShoppingCart, badge: true },
    { to: '/requests', label: 'مبادله', Icon: PiSwap },
    { to: '/library', label: 'کتابخانه شخصی', Icon: LuLibrary },
    { to: '/', label: 'فروشگاه', Icon: LuStore, end: true },
]

const Downbar = () => {
    // The same count as every other cart badge (CartProvider)
    const { count } = useCart()
    return (
        <nav aria-label='منوی اصلی' className='flex md:hidden z-30 justify-center fixed inset-x-0 bottom-0 h-14 bg-white rounded-3xl text-gray-500 shadow-[0_-1px_4px_rgba(0,0,0,0.04)]'>
            <div className='w-full flex items-center'>
                {LINKS.map(({ to, label, Icon, end, badge }) => (
                    <NavLink
                        key={to}
                        to={to}
                        end={end}
                        className={({ isActive }) =>
                            `relative flex flex-auto flex-col items-center ${isActive ? 'font-semibold text-[#4c687c]' : ''}`
                        }
                    >
                        <Icon className='text-2xl' aria-hidden='true' />
                        {badge && count > 0 && (
                            <span className='absolute -top-1.5 right-1/2 flex h-5 min-w-5 translate-x-4 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white'>
                                {count.toLocaleString('fa-IR')}
                                <span className='sr-only'> کتاب در سبد</span>
                            </span>
                        )}
                        <span className='text-xs'>{label}</span>
                    </NavLink>
                ))}
            </div>
        </nav>
    )
}

export default Downbar
