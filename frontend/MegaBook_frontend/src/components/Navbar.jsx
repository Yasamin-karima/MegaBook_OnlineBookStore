import React from 'react'
import { LuBell } from 'react-icons/lu'
import logo from '../assets/logo.svg'

const Navbar = () => {
    return (
        <nav class="flex justify-between fixed inset-x-0 top-0 h-auto bg-[#f9fcfc] rounded-3xl">
            <div className="flex items-center pr-4">
                <img src={logo} className='block-20 justify-end' />
            </div>
            <div className="flex justify-around items-center px-4 gap-3">
                <a href='#'>
                    <LuBell className='text-2xl text-[#4c687c]' />
                </a>
                <div className='bg-[#4c687c] rounded-2xl w-12 h-8 flex justify-center text-white'>
                    ورود
                </div>
            </div>
        </nav>
    )
}

export default Navbar