import React, { useRef, useEffect, useState, useCallback } from 'react'
import { Message, StepOption } from '../types/index'
import MessageBubble from './MessageBubble'
import type { SkillStatus } from '../hooks/useSkillStatus'

interface WatsonChatProps {
  messages: Message[]
  options: StepOption[] | null
  isTyping: boolean
  input_bar_enabled: boolean
  activeSidebar: string | null
  activeSkills: SkillStatus[]
  messagesEndRef: React.RefObject<HTMLDivElement | null>
  inputRef: React.RefObject<HTMLInputElement | null>
  onOptionSelect: (opt: StepOption) => void
  onSend: () => void
  onKeyDown: (e: React.KeyboardEvent) => void
  formatTime: (date: string | Date) => string
  compact?: boolean
  canStop: boolean
  onStop: () => void
}

const SCROLL_THRESHOLD = 150

const WatsonChat: React.FC<WatsonChatProps> = ({
  messages,
  options,
  isTyping,
  input_bar_enabled,
  activeSidebar,
  activeSkills,
  messagesEndRef,
  inputRef,
  onOptionSelect,
  onSend,
  onKeyDown,
  formatTime,
  compact,
  canStop,
  onStop,
}) => {
  const chatRef = useRef<HTMLDivElement>(null)
  const [userScrolledUp, setUserScrolledUp] = useState(false)
  const [hasNewMessages, setHasNewMessages] = useState(false)
  const isAutoScrolling = useRef(false)

  const isNearBottom = useCallback(() => {
    const el = chatRef.current
    if (!el) return true
    return el.scrollHeight - el.scrollTop - el.clientHeight < SCROLL_THRESHOLD
  }, [])

  const hasInitialScrolled = useRef(false)

  const scrollToBottom = useCallback(() => {
    if (!messagesEndRef.current) return
    isAutoScrolling.current = true
    const behavior = hasInitialScrolled.current ? 'smooth' : 'instant'
    hasInitialScrolled.current = true
    messagesEndRef.current.scrollIntoView({ behavior })
    setTimeout(() => { isAutoScrolling.current = false }, 500)
  }, [messagesEndRef])

  // Track scrolled-up state in a ref so ResizeObserver always has current value
  const userScrolledUpRef = useRef(false)
  useEffect(() => { userScrolledUpRef.current = userScrolledUp }, [userScrolledUp])

  // Pin scroll position during container resize (e.g. compact transition)
  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    const observer = new ResizeObserver(() => {
      if (!userScrolledUpRef.current) {
        el.scrollTop = el.scrollHeight
      }
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Track user scroll position
  useEffect(() => {
    const el = chatRef.current
    if (!el) return
    const handleScroll = () => {
      if (isAutoScrolling.current) return
      const nearBottom = isNearBottom()
      setUserScrolledUp(!nearBottom)
      if (nearBottom) setHasNewMessages(false)
    }
    el.addEventListener('scroll', handleScroll, { passive: true })
    return () => el.removeEventListener('scroll', handleScroll)
  }, [isNearBottom])

  // Auto-scroll when new content arrives (unless user scrolled up)
  useEffect(() => {
    if (userScrolledUp) {
      setHasNewMessages(true)
    } else {
      scrollToBottom()
    }
  }, [messages, options, isTyping, activeSkills, userScrolledUp, scrollToBottom])

  function handleJumpToBottom() {
    setUserScrolledUp(false)
    setHasNewMessages(false)
    scrollToBottom()
  }

  return (
    <>
      <div className={`chat-messages${compact ? ' chat-compact' : ''}`} ref={chatRef}>
        {messages.map((msg, i) => {
          // Hide status messages that match a currently active skill (shown at bottom instead)
          if (msg.is_status && activeSkills.some(s => s.message === msg.message_body)) return null
          const showLabel = msg.is_agent && !msg.is_status && !msg.is_divider && (i === 0 || !messages[i - 1]?.is_agent || messages[i - 1]?.is_status || messages[i - 1]?.is_divider)
          return (
            <div key={msg.id ?? i} className="msg-animate">
              {showLabel && <div className="agent-label">WATSON</div>}
              <MessageBubble message={msg} formatTime={formatTime} />
            </div>
          )
        })}

        {options && (
          <div className="msg-animate">
            <div className="options-row">
              {options.map(opt => (
                <button key={opt.id} className="chat-option" onClick={() => onOptionSelect(opt)}>
                  {opt.message}
                </button>
              ))}
            </div>
          </div>
        )}

        {activeSkills.map((skill) => (
          <div key={`${skill.employee}/${skill.skill}`} className="msg-animate">
            <p className="skill-status-text skill-status-active">
              {skill.message ?? 'Working on it...'}
            </p>
          </div>
        ))}

        {isTyping && (
          <div className="msg-animate">
            <div className="typing-dots">
              <span className="typing-dot" />
              <span className="typing-dot" />
              <span className="typing-dot" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {hasNewMessages && (
        <button className="chat-new-messages-btn" onClick={handleJumpToBottom}>
          New messages below
        </button>
      )}

      <div className={`chat-input-area${compact ? ' chat-compact' : ''}`}>
        <div className="chat-input-line">
          <input
            ref={inputRef}
            type="text"
            placeholder="Your message"
            className="chat-input"
            onKeyDown={onKeyDown}
          />
          {canStop && (
            <button
              className="chat-stop-btn"
              onClick={onStop}
              title="Stop the current task and return to chat"
            >
              Stop
            </button>
          )}
          <button
            className="chat-send-btn"
            disabled={!input_bar_enabled || !!activeSidebar}
            onClick={onSend}
          >
            Send
          </button>
        </div>
      </div>
    </>
  )
}

export default WatsonChat
