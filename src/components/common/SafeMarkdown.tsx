import React from 'react';
import {
  parseSafeMarkdownBlocks,
  type SafeInlineToken,
  type SafeMarkdownBlock,
} from '../../../shared/safeMarkdown.ts';

interface SafeMarkdownProps {
  content: string;
  className?: string;
  onInternalLinkClick?: (href: string) => void;
}

export const SafeMarkdown: React.FC<SafeMarkdownProps> = ({
  content,
  className = '',
  onInternalLinkClick,
}) => {
  const blocks: SafeMarkdownBlock[] = React.useMemo(
    () => parseSafeMarkdownBlocks(content || ''),
    [content]
  );

  const renderInlineTokens = (tokens: SafeInlineToken[] = []) =>
    tokens.map((tok, idx) => {
      if (tok.type === 'bold') {
        return (
          <strong key={idx} className="font-semibold text-[#1A1C19]">
            {tok.text}
          </strong>
        );
      }
      if (tok.type === 'code') {
        return (
          <code
            key={idx}
            className="px-1.5 py-0.5 bg-[#F2EFE9] text-[#2D4A3E] rounded text-[13px] font-mono"
          >
            {tok.text}
          </code>
        );
      }
      if (tok.type === 'link' && tok.href) {
        if (tok.isExternal) {
          return (
            <a
              key={idx}
              href={tok.href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[#2D4A3E] font-medium underline underline-offset-2 hover:text-[#C27D56] transition-colors"
            >
              {tok.text}
            </a>
          );
        }
        return (
          <a
            key={idx}
            href={tok.href}
            onClick={(e) => {
              if (onInternalLinkClick && tok.href) {
                e.preventDefault();
                onInternalLinkClick(tok.href);
              }
            }}
            className="text-[#2D4A3E] font-medium underline underline-offset-2 hover:text-[#C27D56] transition-colors"
          >
            {tok.text}
          </a>
        );
      }
      return <React.Fragment key={idx}>{tok.text}</React.Fragment>;
    });

  return (
    <div className={`space-y-4 text-sm text-[#3D3A34] leading-relaxed ${className}`}>
      {blocks.map((block, bIdx) => {
        if (block.type === 'heading') {
          if (block.level === 1) {
            return (
              <h2
                key={bIdx}
                className="font-display text-xl sm:text-2xl font-bold text-[#1A1C19] pt-2"
              >
                {renderInlineTokens(block.tokens)}
              </h2>
            );
          }
          if (block.level === 2) {
            return (
              <h3
                key={bIdx}
                className="font-display text-base sm:text-lg font-bold text-[#1A1C19] pt-3 border-b border-[#EAE6DE] pb-1.5"
              >
                {renderInlineTokens(block.tokens)}
              </h3>
            );
          }
          return (
            <h4 key={bIdx} className="font-semibold text-sm sm:text-base text-[#1A1C19] pt-2">
              {renderInlineTokens(block.tokens)}
            </h4>
          );
        }

        if (block.type === 'unordered-list') {
          return (
            <ul key={bIdx} className="list-disc pl-5 space-y-2">
              {(block.items || []).map((itemTokens, iIdx) => (
                <li key={iIdx} className="leading-relaxed">
                  {renderInlineTokens(itemTokens)}
                </li>
              ))}
            </ul>
          );
        }

        if (block.type === 'ordered-list') {
          return (
            <ol key={bIdx} className="list-decimal pl-5 space-y-2">
              {(block.items || []).map((itemTokens, iIdx) => (
                <li key={iIdx} className="leading-relaxed">
                  {renderInlineTokens(itemTokens)}
                </li>
              ))}
            </ol>
          );
        }

        return (
          <p key={bIdx} className="leading-relaxed">
            {renderInlineTokens(block.tokens)}
          </p>
        );
      })}
    </div>
  );
};
