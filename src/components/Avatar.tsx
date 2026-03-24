import { motion } from "motion/react";

export type Expression = "neutral" | "happy" | "thinking" | "surprised" | "sad";

interface AvatarProps {
  expression: Expression;
}

export const Avatar = ({ expression }: AvatarProps) => {
  const variants = {
    neutral: {
      mouth: { d: "M 40 65 Q 50 65 60 65" },
      eyes: { scaleY: 1 },
      eyebrows: { y: 0, rotate: 0 },
    },
    happy: {
      mouth: { d: "M 35 60 Q 50 75 65 60" },
      eyes: { scaleY: 0.8 },
      eyebrows: { y: -2, rotate: 0 },
    },
    thinking: {
      mouth: { d: "M 45 65 Q 50 60 55 65" },
      eyes: { scaleY: 1 },
      eyebrows: { y: -3, rotate: -5 },
    },
    surprised: {
      mouth: { d: "M 45 70 A 5 5 0 1 0 55 70 A 5 5 0 1 0 45 70" },
      eyes: { scaleY: 1.2 },
      eyebrows: { y: -5, rotate: 0 },
    },
    sad: {
      mouth: { d: "M 35 70 Q 50 60 65 70" },
      eyes: { scaleY: 1 },
      eyebrows: { y: 2, rotate: 5 },
    },
  };

  return (
    <div className="relative w-48 h-48 mx-auto">
      <svg
        viewBox="0 0 100 100"
        className="w-full h-full drop-shadow-xl"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Face Shape */}
        <circle cx="50" cy="50" r="45" fill="#FFF0E0" stroke="#FFB6C1" strokeWidth="2" />
        
        {/* Blush */}
        <circle cx="25" cy="55" r="5" fill="#FFB6C1" opacity="0.4" />
        <circle cx="75" cy="55" r="5" fill="#FFB6C1" opacity="0.4" />
        
        {/* Hair (Softer, more active style) */}
        <path
          d="M 5 50 Q 5 10 50 5 Q 95 10 95 50 L 100 60 Q 100 0 50 0 Q 0 0 0 60 Z"
          fill="#6B4226"
        />
        <path
          d="M 5 50 Q 15 40 30 45 Q 50 35 70 45 Q 85 40 95 50"
          stroke="#6B4226"
          strokeWidth="4"
          strokeLinecap="round"
        />

        {/* Eyes */}
        <motion.g animate={variants[expression].eyes} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <circle cx="35" cy="45" r="4" fill="#333" />
          <circle cx="65" cy="45" r="4" fill="#333" />
        </motion.g>

        {/* Eyebrows */}
        <motion.g animate={variants[expression].eyebrows} transition={{ type: "spring", stiffness: 300, damping: 20 }}>
          <rect x="30" y="35" width="10" height="2" rx="1" fill="#4A3728" />
          <rect x="60" y="35" width="10" height="2" rx="1" fill="#4A3728" />
        </motion.g>

        {/* Mouth */}
        <motion.path
          animate={variants[expression].mouth}
          transition={{ type: "spring", stiffness: 300, damping: 20 }}
          stroke="#333"
          strokeWidth="3"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
      
      {/* Glow effect */}
      <div className="absolute inset-0 bg-pink-400/10 rounded-full blur-2xl -z-10" />
    </div>
  );
};
