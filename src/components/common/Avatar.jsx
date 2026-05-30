import React from 'react';

/**
 * Small circular employee avatar.
 *
 * Props:
 *   src       — data URL or image path (typically employee.profile_picture_path
 *               OR profilePicturePath). If falsy, falls back to an initial.
 *   name      — used both as the alt text and to derive the initial fallback.
 *   size      — pixels (default 32). Controls width / height / font size.
 *   bgColor   — background colour for the initial fallback (default amber).
 *   style     — extra style props to merge.
 *
 * Example:
 *   <Avatar src={emp.profile_picture_path} name={emp.fullName} size={28} />
 */
function Avatar({ src, name, size = 32, bgColor = '#f59e0b', style = {} }) {
  const initial = ((name || '?').trim().charAt(0) || '?').toUpperCase();
  const baseStyle = {
    width: size,
    height: size,
    borderRadius: '50%',
    flexShrink: 0,
    overflow: 'hidden',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    color: '#ffffff',
    fontWeight: 700,
    fontSize: Math.max(10, Math.round(size * 0.4)),
    textTransform: 'uppercase',
    border: '1.5px solid rgba(255,255,255,0.06)',
    background: bgColor,
    ...style
  };

  if (src && typeof src === 'string' && src.length > 0) {
    return (
      <span style={baseStyle}>
        <img
          src={src}
          alt={name || ''}
          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          onError={(e) => {
            // If the image fails to load (corrupt data URL, broken path, etc.)
            // hide the <img> so the initial fallback shows through.
            e.currentTarget.style.display = 'none';
          }}
        />
      </span>
    );
  }

  return (
    <span style={baseStyle} aria-label={name || 'employee'}>
      {initial}
    </span>
  );
}

export default Avatar;
