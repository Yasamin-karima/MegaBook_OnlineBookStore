import React from 'react'
import { LuShoppingCart, LuLibrary, LuUser, LuStore } from 'react-icons/lu'
import { PiSwap } from 'react-icons/pi'


const Downbar = () => {
    return (
        <nav className='flex z-10 justify-center fixed inset-x-0 bottom-0 h-14 bg-white rounded-3xl text-gray-500'>
            <div class="w-full flex items-center">
                <div className="flex flex-auto flex-col items-center">
                    <LuUser className='text-2xl' />
                    <a href="#" className="text-xs">
                        داشبورد
                    </a>
                </div>
                <div className="flex flex-auto flex-col items-center">
                    <LuShoppingCart className='text-2xl' />
                    <a href="#" class="text-xs">
                        سبد خرید
                    </a>
                </div>
                <div className="flex flex-auto flex-col items-center">
                    <PiSwap className='text-2xl' />
                    <a href="#" class="text-xs">
                        مبادله
                    </a>
                </div>
                <div className="flex flex-auto flex-col items-center">
                    <LuLibrary className='text-2xl' />
                    <a href="#" class="text-xs">
                        کتابخانه شخصی
                    </a>
                </div>
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