import * as React from "react"

import { cn } from "@/lib/utils"

/** @typedef {React.HTMLAttributes<HTMLDivElement>} CardProps */

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, CardProps>} */
const CardRender = ({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("rounded-xl border bg-card text-card-foreground shadow", className)}
    {...props} />
)
const Card = React.forwardRef(CardRender)
Card.displayName = "Card"

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, CardProps>} */
const CardHeaderRender = ({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex flex-col space-y-1.5 p-6", className)}
    {...props} />
)
const CardHeader = React.forwardRef(CardHeaderRender)
CardHeader.displayName = "CardHeader"

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, CardProps>} */
const CardTitleRender = ({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("font-semibold leading-none tracking-tight", className)}
    {...props} />
)
const CardTitle = React.forwardRef(CardTitleRender)
CardTitle.displayName = "CardTitle"

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, CardProps>} */
const CardDescriptionRender = ({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props} />
)
const CardDescription = React.forwardRef(CardDescriptionRender)
CardDescription.displayName = "CardDescription"

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, CardProps>} */
const CardContentRender = ({ className, ...props }, ref) => (
  <div ref={ref} className={cn("p-6 pt-0", className)} {...props} />
)
const CardContent = React.forwardRef(CardContentRender)
CardContent.displayName = "CardContent"

/** @type {React.ForwardRefRenderFunction<HTMLDivElement, CardProps>} */
const CardFooterRender = ({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center p-6 pt-0", className)}
    {...props} />
)
const CardFooter = React.forwardRef(CardFooterRender)
CardFooter.displayName = "CardFooter"

export { Card, CardHeader, CardFooter, CardTitle, CardDescription, CardContent }
