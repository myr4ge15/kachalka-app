// Только для e2e: этот модуль не импортируется приложением и не входит в сборку.
import React from 'react'
import { createRoot } from 'react-dom/client'
import DomainMigration from '../components/app/DomainMigration.jsx'
import '../index.css'

createRoot(document.getElementById('root')).render(
  <DomainMigration userId="migration-preview" phase="retire" />,
)
