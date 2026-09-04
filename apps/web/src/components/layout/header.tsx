import React from 'react'
import { HarnessPageHeader } from '@/components/ui/harness-ui'

interface HeaderProps {
  title: string
  description?: string
  product?: string
  action?: React.ReactNode
}

export default function Header({ title, description, product = 'LINE', action }: HeaderProps) {
  return <HarnessPageHeader title={title} description={description} product={product} action={action} />
}
