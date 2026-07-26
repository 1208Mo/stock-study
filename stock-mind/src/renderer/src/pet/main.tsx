import React from 'react'
import { createRoot } from 'react-dom/client'
import Pet from './Pet'

const root = document.getElementById('pet-root')
if (root) {
    createRoot(root).render(<Pet />)
}