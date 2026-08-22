import { describe, expect, it } from 'vitest'
import { commitMessageViolations } from '../commit-message.ts'

const IDENTITY = 'someone@example.com'

/**
 * The length bound's two sides, one character apart and identical otherwise.
 *
 * Only a subject of exactly fifty separates `>= 50` from `> 50` and from
 * `>= 51`; at fifty-one all three reject it and none of them is observed. The
 * longest subject in history is forty-eight, so history cannot supply this
 * pair and it is constructed.
 */
const FIFTY = "read the guest's orders back from the row it wrote"
const FORTY_NINE = "read the guest's order back from the row it wrote"

const CLEAN = [
  'set up toolchain and ci',
  '',
  'One command runs every repository check: pnpm verify.',
  'Convention checks land before there is any code to violate them.',
  'No application code yet.',
].join('\n')

function reasons(message: string, identity = IDENTITY): string[] {
  return commitMessageViolations(message, identity).map((violation) => violation.reason)
}

describe('commitMessageViolations', () => {
  it('accepts a subject, a body and nothing else', () => {
    expect(commitMessageViolations(CLEAN, IDENTITY)).toEqual([])
  })

  it('accepts a bare subject line', () => {
    expect(commitMessageViolations('set up toolchain and ci', IDENTITY)).toEqual([])
  })

  /**
   * Each fixture below violates one clause and no other, so that what it
   * establishes is the clause it is named for. A subject carrying a capitalised
   * Conventional Commits type violates two and establishes neither, and the
   * assertions are equality rather than containment to keep it that way.
   */
  describe('the subject line', () => {
    describe('a Conventional Commits prefix', () => {
      it('rejects a subject carrying one', () => {
        expect(reasons("feat: send the order from the guest's page")).toEqual([
          'Conventional Commits prefix "feat:"',
        ])
      })

      it('accepts the same subject with the prefix removed', () => {
        const message = "send the order from the guest's page"
        expect(commitMessageViolations(message, IDENTITY)).toEqual([])
      })
    })

    describe('lowercase', () => {
      it('rejects a capitalised first word', () => {
        expect(reasons("Send the order from the guest's page")).toEqual([
          'subject is not lowercase',
        ])
      })

      // The capital sits at the end of the value, where a rule reading only the
      // first character does not look. Without this fixture the two readings of
      // "lowercase" are indistinguishable: every subject in history satisfies
      // both, and so does the fixture above.
      it('rejects a capital that is not the first character', () => {
        expect(reasons("send the order from the guest's Page")).toEqual([
          'subject is not lowercase',
        ])
      })

      it('accepts the same subject in lowercase throughout', () => {
        const message = "send the order from the guest's page"
        expect(commitMessageViolations(message, IDENTITY)).toEqual([])
      })
    })

    describe('the length bound', () => {
      // The fixture guard. A pair that drifted off fifty and forty-nine would
      // still read as two long subjects and would observe no bound at all.
      it('is written from both sides of exactly fifty', () => {
        expect(FIFTY).toHaveLength(50)
        expect(FORTY_NINE).toHaveLength(49)
      })

      it('rejects a subject of fifty characters', () => {
        expect(reasons(FIFTY)).toEqual(['subject is 50 characters, the limit is under 50'])
      })

      it('accepts a subject of forty-nine', () => {
        expect(commitMessageViolations(FORTY_NINE, IDENTITY)).toEqual([])
      })
    })
  })

  describe('attribution trailers', () => {
    it.each([
      'Co-Authored-By: Someone <someone@example.com>',
      'Co-authored-by: An Agent <noreply@anthropic.com>',
      'Reviewed-by: Another Agent <noreply@moonshot.cn>',
      'Authored-By: Whoever <whoever@example.com>',
    ])('rejects %s', (trailer) => {
      expect(reasons(`subject line\n\n${trailer}`)).toContain('attribution trailer')
    })

    it('rejects an agent address from a vendor nobody listed', () => {
      const message = 'subject line\n\nCo-Authored-By: Some Model <noreply@example-vendor.test>'
      expect(reasons(message)).toContain('attribution trailer')
    })

    it('allows Signed-off-by carrying the commit author', () => {
      const message = `subject line\n\nSigned-off-by: A Human <${IDENTITY}>`
      expect(commitMessageViolations(message, IDENTITY)).toEqual([])
    })

    it('rejects Signed-off-by carrying anybody who is not the author', () => {
      const message = 'subject line\n\nSigned-off-by: Someone Else <other@example.com>'
      expect(reasons(message)).toContain('attribution trailer')
    })

    // The addresses differ only in that one contains the other, so a
    // containment test written without the angle brackets would call them
    // equal. A pair differing at the first character establishes nothing here.
    it('rejects a sign-off whose address merely contains the author address', () => {
      const message = 'subject line\n\nSigned-off-by: B <ba@example.test>'
      expect(reasons(message, 'a@example.test')).toContain('attribution trailer')
    })

    it('rejects Signed-off-by when the author address is unknown', () => {
      const message = `subject line\n\nSigned-off-by: A Human <${IDENTITY}>`
      expect(reasons(message, '')).toContain('attribution trailer')
    })
  })

  describe('session trailers and URLs', () => {
    it.each(['Claude-Session: abc123', 'Some-Session: xyz'])('rejects %s', (trailer) => {
      expect(reasons(`subject line\n\n${trailer}`)).toContain('session trailer')
    })

    it.each([
      'https://claude.ai/session/abc-123',
      'https://example.test/traces/9',
      'https://example.test/conversation/9',
      'https://example.test/chat/9',
    ])('rejects the body URL %s', (url) => {
      expect(reasons(`subject line\n\nsee ${url} for context`)).toContain(
        'session, trace or conversation URL',
      )
    })

    it('leaves an ordinary URL alone', () => {
      const message = 'subject line\n\nsee https://www.gnu.org/licenses/agpl-3.0.txt'
      expect(commitMessageViolations(message, IDENTITY)).toEqual([])
    })
  })

  describe('generated-by lines', () => {
    it.each([
      'Generated with a tool',
      'generated by a tool',
      'Assisted by a tool',
      'Written by a tool',
    ])('rejects %s', (phrase) => {
      expect(reasons(`subject line\n\n${phrase}`)).toContain('generated-by line')
    })
  })

  describe('emoji', () => {
    it('rejects an emoji in the subject', () => {
      expect(reasons('set up toolchain ✨')).toContain('emoji')
    })

    it('rejects an emoji in the body', () => {
      expect(reasons('subject line\n\nall done 🎉')).toContain('emoji')
    })

    it('rejects a flag built from regional indicators', () => {
      expect(reasons('subject line\n\n🇬🇧')).toContain('emoji')
    })
  })

  describe('the trailer block', () => {
    it('rejects a trailer that is not on the allow list', () => {
      expect(reasons('subject line\n\nRefs: PROJ-1')).toContain(
        'trailer "Refs" is not on the allow list',
      )
    })

    /**
     * The pair below separates two rules whose shapes overlap. Both are
     * one-line messages whose only line is trailer-shaped, and neither is a
     * trailer, because a message's only paragraph is not a trailer block --
     * which is the whole of what the first one asserts, and why it has to be
     * trailer-shaped rather than merely carrying a colon.
     *
     * They differ in the prefix clause alone. A Conventional Commits type is
     * letters, so `fix:` is a prefix; a trailer key may carry a hyphen, so
     * `check-push:` is not one.
     */
    it('does not treat a one-line trailer-shaped subject as a trailer', () => {
      expect(commitMessageViolations('check-push: read the log', IDENTITY)).toEqual([])
    })

    it('rejects that shape when the key is a Conventional Commits type', () => {
      expect(reasons('fix: a thing')).toEqual(['Conventional Commits prefix "fix:"'])
    })

    it('does not treat a prose final paragraph as a trailer block', () => {
      const message = 'subject line\n\nNote: the body may contain a colon.\nSo may this line.'
      expect(commitMessageViolations(message, IDENTITY)).toEqual([])
    })

    it('reports the line number of the offending trailer', () => {
      const message = 'subject line\n\nbody\n\nCo-Authored-By: Agent <noreply@example.test>'
      expect(commitMessageViolations(message, IDENTITY)).toEqual([
        {
          line: 5,
          text: 'Co-Authored-By: Agent <noreply@example.test>',
          reason: 'attribution trailer',
        },
      ])
    })
  })
})
