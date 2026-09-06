import React from 'react'
import cover from '../assets/book-covers/301984.jpg'
import { LuShoppingCart } from 'react-icons/lu'

const BookCard = ({ image_width = 180 }) => {
    return (
        <div className={`relative w-[${image_width}px] h-[${2 * image_width}px] shadow-2xl p-1 rounded-lg`}>
            <img src={cover} className='w-full rounded-lg' />
            <div>
                <h3 className='text-xl font-bold'>
                    قطار نیمه شب
                </h3>
                <h4 className='text-md'>
                    مت هیگ
                </h4>
                <h3 className='text-xl ltr'>
                    ۳۰۰,۰۰۰ ت
                </h3>
            </div>
            <button className='absolute flex justify-center items-center bottom-1 left-1 bg-[#dfe1e4] size-10 rounded-full'>
                <LuShoppingCart className='text-2xl' />
            </button>
        </div>
    )
}

export default BookCard