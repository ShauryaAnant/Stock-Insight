import { useEffect, useId, useRef, useState } from 'react'
import type { FormEvent, KeyboardEvent } from 'react'

import { fetchSearchSuggestions } from '../api'
import type { SearchSuggestion } from '../types'

type StockSearchFormProps = {
  ariaLabel: string
  buttonLabel: string
  className: string
  clearOnSearch?: boolean
  initialValue?: string
  onSearch: (ticker: string) => void
  placeholder: string
}

export function StockSearchForm({
  ariaLabel,
  buttonLabel,
  className,
  clearOnSearch = false,
  initialValue = '',
  onSearch,
  placeholder,
}: StockSearchFormProps) {
  const [query, setQuery] = useState(initialValue)
  const [suggestions, setSuggestions] = useState<SearchSuggestion[]>([])
  const [isFocused, setIsFocused] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [highlightSource, setHighlightSource] = useState<'keyboard' | 'mouse' | null>(null)
  const [submitError, setSubmitError] = useState('')
  const listboxId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    setQuery(initialValue)
    setSubmitError('')
    setSuggestions([])
    setActiveIndex(-1)
    setHighlightSource(null)
  }, [initialValue])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setSuggestions([])
      setActiveIndex(-1)
      setHighlightSource(null)
      setIsLoading(false)
      return
    }

    const controller = new AbortController()
    setSuggestions([])
    setActiveIndex(-1)
    setHighlightSource(null)
    setIsLoading(true)

    const timeoutId = window.setTimeout(() => {
      fetchSearchSuggestions(trimmed, 8, controller.signal)
        .then((nextSuggestions) => {
          setSuggestions(nextSuggestions)
          setActiveIndex(-1)
          setHighlightSource(null)
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === 'AbortError') {
            return
          }
          setSuggestions([])
          setActiveIndex(-1)
          setHighlightSource(null)
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setIsLoading(false)
          }
        })
    }, 180)

    return () => {
      controller.abort()
      window.clearTimeout(timeoutId)
    }
  }, [query])

  const showDropdown = isFocused && Boolean(query.trim()) && (isLoading || suggestions.length > 0)
  const showNoResults =
    isFocused && Boolean(query.trim()) && !isLoading && suggestions.length === 0

  const chooseSuggestion = (suggestion: SearchSuggestion) => {
    setSuggestions([])
    setActiveIndex(-1)
    setHighlightSource(null)
    setSubmitError('')
    if (clearOnSearch) {
      setQuery('')
      setIsFocused(true)
      onSearch(suggestion.ticker)
      window.requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
      return
    }
    setQuery(suggestion.ticker)
    setIsFocused(false)
    onSearch(suggestion.ticker)
  }

  const resolveSearchTarget = async (): Promise<SearchSuggestion | null> => {
    const trimmed = query.trim()
    if (!trimmed) {
      return null
    }

    if (activeIndex >= 0 && suggestions[activeIndex]) {
      return suggestions[activeIndex]
    }

    const lowerQuery = trimmed.toLowerCase()
    const exactSuggestion = suggestions.find((suggestion) => {
      return (
        suggestion.ticker.toLowerCase() === lowerQuery ||
        suggestion.name.toLowerCase() === lowerQuery
      )
    })
    if (exactSuggestion) {
      return exactSuggestion
    }

    const freshSuggestions = await fetchSearchSuggestions(trimmed, 1)
    if (freshSuggestions[0]?.ticker.toLowerCase() === lowerQuery) {
      return freshSuggestions[0]
    }

    return null
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (isSubmitting) {
      return
    }

    setSubmitError('')
    setIsSubmitting(true)

    try {
      const target = await resolveSearchTarget()
      if (!target?.ticker) {
        setSubmitError('Ticker not found')
        window.setTimeout(() => {
          setSubmitError('')
        }, 2200)
        return
      }
      chooseSuggestion(target)
    } catch {
      setSubmitError('Search error')
      window.setTimeout(() => {
        setSubmitError('')
      }, 2200)
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      if (suggestions.length === 0) {
        return
      }
      setHighlightSource('keyboard')
      setActiveIndex((currentIndex) => {
        if (currentIndex < 0) {
          return 0
        }
        return (currentIndex + 1) % suggestions.length
      })
      return
    }

    if (event.key === 'ArrowUp') {
      event.preventDefault()
      if (suggestions.length === 0) {
        return
      }
      setHighlightSource('keyboard')
      setActiveIndex((currentIndex) => {
        if (currentIndex < 0) {
          return suggestions.length - 1
        }
        return (currentIndex - 1 + suggestions.length) % suggestions.length
      })
      return
    }

    if (event.key === 'Escape') {
      setSuggestions([])
      setActiveIndex(-1)
      setHighlightSource(null)
      setIsFocused(false)
    }
  }

  return (
    <form className={className} onSubmit={handleSubmit}>
      <div className="search-field">
        <input
          ref={inputRef}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setSubmitError('')
          }}
          onFocus={() => setIsFocused(true)}
          onBlur={() => {
            window.setTimeout(() => {
              setIsFocused(false)
            }, 120)
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showDropdown || showNoResults}
          aria-haspopup="listbox"
          role="combobox"
          autoComplete="off"
        />

        {(showDropdown || showNoResults) && (
          <div
            className="search-suggestions"
            id={listboxId}
            role="listbox"
            onMouseLeave={() => {
              if (highlightSource === 'mouse') {
                setActiveIndex(-1)
                setHighlightSource(null)
              }
            }}
          >
            {suggestions.map((suggestion, index) => {
              const isActive = index === activeIndex
              return (
                <button
                  key={`${suggestion.ticker}-${suggestion.exchange ?? index}`}
                  type="button"
                  className={`search-suggestion${isActive ? ' is-active' : ''}`}
                  role="option"
                  aria-selected={isActive}
                  onMouseEnter={() => {
                    setActiveIndex(index)
                    setHighlightSource('mouse')
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => chooseSuggestion(suggestion)}
                >
                  <span className="search-suggestion-primary">
                    <span className="search-suggestion-symbol">{suggestion.ticker}</span>
                    <span className="search-suggestion-name">{suggestion.name}</span>
                  </span>
                  {(suggestion.exchange || suggestion.type) && (
                    <span className="search-suggestion-meta">
                      {[suggestion.exchange, suggestion.type].filter(Boolean).join(' | ')}
                    </span>
                  )}
                </button>
              )
            })}

            {isLoading && (
              <div className="search-suggestion-status" aria-live="polite">
                Searching...
              </div>
            )}

            {showNoResults && (
              <div className="search-suggestion-status" aria-live="polite">
                No matches found.
              </div>
            )}
          </div>
        )}

        {submitError && <p className="search-feedback">{submitError}</p>}
      </div>

      <button type="submit" disabled={!query.trim() || isSubmitting}>
        {buttonLabel}
      </button>
    </form>
  )
}
