import React from 'react'
import { createRoot } from 'react-dom/client'
import Mini from './Mini'
import './mini.css'

const root = document.getElementById('mini-root')
if (root) {
    createRoot(root).render(<Mini />)
}
