import React from 'react'
import { Link } from 'react-router-dom'
import useCart from '../hooks/useCart'
import { LuShoppingCart, LuLibrary, LuUser, LuStore } from 'react-icons/lu'
import { PiSwap } from 'react-icons/pi'


const Downbar = () => {
    // The same count as every other cart badge (CartProvider)
    const { count } = useCart()
    return (
        <nav className='flex z-10 justify-center fixed inset-x-0 bottom-0 h-14 bg-white rounded-3xl text-gray-500'>
            <div class="w-full flex items-center">
                <Link to="/dashboard" className="flex flex-auto flex-col items-center">
                    <LuUser className='text-2xl' />
                    <span className="text-xs">
                        داشبورد
                    </span>
                </Link>
                <Link to="/cart" className="relative flex flex-auto flex-col items-center">
                    <LuShoppingCart className='text-2xl' />
                    {count > 0 && (
                        <span className="absolute -top-1.5 right-1/2 flex h-5 min-w-5 translate-x-4 items-center justify-center rounded-full bg-red-500 px-1 text-[11px] font-bold text-white">
                            {count.toLocaleString('fa-IR')}
                        </span>
                    )}
                    <span className="text-xs">
                        سبد خرید
                    </span>
                </Link>
                <div className="flex flex-auto flex-col items-center">
                    <PiSwap className='text-2xl' />
                    <a href="#" class="text-xs">
                        مبادله
                    </a>
                </div>
                <Link to="/library" className="flex flex-auto flex-col items-center">
                    <LuLibrary className='text-2xl' />
                    <span className="text-xs">
                        کتابخانه شخصی
                    </span>
                </Link>
                <div className="flex flex-auto flex-col items-center">
                    <LuStore className='text-2xl' />
                    <a href="#" class="text-xs">
                        فروشگاه
                    </a>
                </div>
            </div>
        </nav>
    )
}

export default Downbar