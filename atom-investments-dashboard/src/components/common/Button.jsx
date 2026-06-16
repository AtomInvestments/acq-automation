import { motion } from 'framer-motion';

export default function Button({
  children,
  variant = 'default',
  size = 'md',
  onClick = null,
  disabled = false,
  type = 'button',
  className = '',
  ...props
}) {
  const baseClasses = `
    inline-flex items-center justify-center font-medium
    transition-all duration-200 cursor-pointer
    focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-blue-500
    disabled:opacity-50 disabled:cursor-not-allowed
  `;

  const sizeClasses = {
    sm: 'px-3 py-1.5 text-sm rounded-md',
    md: 'px-4 py-2 text-sm rounded-md',
    lg: 'px-6 py-3 text-base rounded-md',
  };

  const variantClasses = {
    default: `
      bg-slate-900 text-white hover:bg-slate-800
      shadow-sm hover:shadow-md
      active:bg-slate-950
    `,
    secondary: `
      bg-slate-100 text-slate-900 hover:bg-slate-200
      shadow-sm hover:shadow-md
      active:bg-slate-300
    `,
    outline: `
      border border-slate-300 text-slate-700 hover:bg-slate-50
      hover:border-slate-400
      active:bg-slate-100
    `,
    ghost: `
      text-slate-700 hover:bg-slate-100
      active:bg-slate-200
    `,
    destructive: `
      bg-red-600 text-white hover:bg-red-700
      shadow-sm hover:shadow-md
      active:bg-red-800
    `,
  };

  const style = `${baseClasses} ${sizeClasses[size]} ${variantClasses[variant]} ${className}`;

  const handleClick = (e) => {
    if (!disabled && onClick) {
      onClick(e);
    }
  };

  return (
    <motion.button
      type={type}
      className={style}
      onClick={handleClick}
      disabled={disabled}
      whileTap={disabled ? {} : { scale: 0.98 }}
      whileHover={disabled ? {} : { y: -1 }}
      transition={{ duration: 0.2 }}
      {...props}
    >
      {children}
    </motion.button>
  );
}
