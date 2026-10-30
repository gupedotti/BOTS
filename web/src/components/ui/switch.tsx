"use client"

import * as React from "react"
import { cn } from "@/lib/utils"
import { Switch as SwitchPrimitive } from "radix-ui"

function Switch({
  className,
  size = "default",
  ...props
}: React.ComponentProps<typeof SwitchPrimitive.Root> & {
  size?: "sm" | "default"
}) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      data-size={size}
      className={cn(
        "peer group/switch inline-flex shrink-0 items-center rounded-full border border-transparent transition-colors duration-200 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-6 data-[size=default]:w-[42px] cursor-pointer data-[size=sm]:h-3.5 data-[size=sm]:w-6 data-[state=checked]:bg-grad data-[state=checked]:shadow-[0_0_16px_-4px_rgba(14,165,233,0.8)] data-[state=unchecked]:bg-white/[0.14] dark:data-[state=unchecked]:bg-white/[0.14]",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block rounded-full bg-background ring-0 transition-transform group-data-[size=default]/switch:size-5 duration-300 ease-[var(--spring)] group-data-[size=sm]/switch:size-3 data-[state=checked]:translate-x-[calc(100%-1px)] data-[state=unchecked]:translate-x-px bg-white shadow-sm"
        )}
      />
    </SwitchPrimitive.Root>
  )
}

export { Switch }
