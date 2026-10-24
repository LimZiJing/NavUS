import { useState } from 'react'
import { Button, IconButton } from '../../../ui/button'
import { FavoriteIcon } from '../../../ui/icons'

export interface FavoriteStopSummary {
  readonly id: string
  readonly name: string
}

interface FavouritesSectionProps {
  readonly stops: readonly FavoriteStopSummary[]
  readonly onRemove: (stopId: string) => void
  readonly onClear: () => void
}

export function FavouritesSection({ stops, onRemove, onClear }: FavouritesSectionProps) {
  const [statusMessage, setStatusMessage] = useState('')

  const removeStop = (stop: FavoriteStopSummary): void => {
    onRemove(stop.id)
    setStatusMessage(`${stop.name} removed from favourites.`)
  }

  const clearAllStops = (): void => {
    if (!window.confirm('Clear all favourite bus stops?')) return
    onClear()
    setStatusMessage('Favourites cleared.')
  }

  return (
    <div className="settings-favourites">
      {stops.length === 0 ? (
        <p>Star a stop in Stops to add it to your favourites.</p>
      ) : (
        <div className="settings-favourite-card">
          <ul className="settings-favourite-list">
            {stops.map((stop) => (
              <li className="settings-favourite-row" key={stop.id}>
                <span>{stop.name}</span>
                <IconButton
                  className="settings-favourite-remove"
                  variant="plain"
                  size="sm"
                  label={`Remove ${stop.name} from favourites`}
                  icon={<FavoriteIcon filled />}
                  pressed
                  onClick={() => removeStop(stop)}
                />
              </li>
            ))}
          </ul>
          <div className="settings-favourites-actions">
            <Button
              className="settings-favourites-clear"
              label="Clear all"
              onClick={clearAllStops}
            />
          </div>
        </div>
      )}
      {statusMessage && <p className="settings-status-message" role="status">{statusMessage}</p>}
    </div>
  )
}
