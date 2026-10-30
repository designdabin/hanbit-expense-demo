import * as React from "react";
import { cn } from "@/lib/utils";
import { clauses } from "./clauses";

export function Alert({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-alert", className)} {...props} />;
}
export function AlertTitle({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-alert-title", className)} {...props}>{clauses(children)}</div>;
}
export function AlertDescription({ className, children, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("ui-alert-description", className)} {...props}>{clauses(children)}</div>;
}
