import { describe, it, expect } from 'vitest'
import { classifyTwilioMessageStatus } from '@/lib/whatsapp/outbound/status-callback'

describe('classifyTwilioMessageStatus', () => {
  it.each(['queued', 'sending', 'sent', 'delivered', 'read'])('"%s" is a no-op', (messageStatus) => {
    expect(classifyTwilioMessageStatus({ messageSid: 'SMabc', messageStatus })).toEqual({ action: 'noop' })
  })

  it.each(['undelivered', 'failed'])('"%s" marks the row failed, preferring ChannelStatusMessage over ErrorCode', (messageStatus) => {
    const result = classifyTwilioMessageStatus({
      messageSid: 'SMabc',
      messageStatus,
      errorCode: '30003',
      channelStatusMessage: 'Message failed to reach the recipient',
    })
    expect(result.action).toBe('mark_failed')
    if (result.action === 'mark_failed') {
      expect(result.error).toContain(messageStatus)
      expect(result.error).toContain('Message failed to reach the recipient')
      expect(result.error).not.toContain('30003') // message text preferred, code not duplicated
    }
  })

  it('falls back to the bare ErrorCode when no ChannelStatusMessage is present', () => {
    const result = classifyTwilioMessageStatus({ messageSid: 'SMabc', messageStatus: 'failed', errorCode: '30003' })
    expect(result.action).toBe('mark_failed')
    if (result.action === 'mark_failed') {
      expect(result.error).toContain('ErrorCode 30003')
    }
  })

  it('falls back to the bare status label when neither ChannelStatusMessage nor ErrorCode is present', () => {
    const result = classifyTwilioMessageStatus({ messageSid: 'SMabc', messageStatus: 'undelivered' })
    expect(result.action).toBe('mark_failed')
    if (result.action === 'mark_failed') {
      expect(result.error).toContain('undelivered')
    }
  })

  it('an unrecognized status is neither a no-op nor a failure -- reported, not acted on', () => {
    expect(classifyTwilioMessageStatus({ messageSid: 'SMabc', messageStatus: 'some_future_status' })).toEqual({
      action: 'unrecognized_status',
    })
  })

  it('scheduled/canceled (the Messaging Services scheduling feature, unused by this codebase) are unrecognized, not silently treated as benign', () => {
    expect(classifyTwilioMessageStatus({ messageSid: 'SMabc', messageStatus: 'scheduled' }).action).toBe('unrecognized_status')
    expect(classifyTwilioMessageStatus({ messageSid: 'SMabc', messageStatus: 'canceled' }).action).toBe('unrecognized_status')
  })
})
