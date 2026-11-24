import type { ComponentProps } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";

const buttonVariants = cva("inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3.5 text-sm font-semibold transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2", {
  variants: { variant: {
    default: "border-neutral-950 bg-neutral-950 text-white hover:bg-neutral-700",
    outline: "border-[#deddd6] bg-white hover:bg-[#f2f1ec]",
    ghost: "border-transparent hover:bg-[#eeede7]",
  } },
  defaultVariants: { variant: "default" },
});

export function Button({ className, variant, type = "button", ...props }: ComponentProps<"button"> & VariantProps<typeof buttonVariants>) {
  return <button type={type} className={twMerge(clsx(buttonVariants({variant}), className))} {...props} />;
}
