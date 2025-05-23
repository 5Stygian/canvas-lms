/*
 * Copyright (C) 2020 - present Instructure, Inc.
 *
 * This file is part of Canvas.
 *
 * Canvas is free software: you can redistribute it and/or modify it under
 * the terms of the GNU Affero General Public License as published by the Free
 * Software Foundation, version 3 of the License.
 *
 * Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
 * WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
 * A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
 * details.
 *
 * You should have received a copy of the GNU Affero General Public License along
 * with this program. If not, see <http://www.gnu.org/licenses/>.
 */

import qs from 'qs'

export interface Response {
  request: {
    _request: {
      respond: (status: number, headers: Record<string, string>, body: string | null) => void
    }
    params: Record<string, unknown>
    path: string
  }
  setHeader: (name: string, value: string) => void
  send: () => void
}

interface PaginationLinks {
  first?: string | number
  current?: string | number
  next?: string | number
  last?: string | number
}

export default function setPaginationLinkHeader(
  response: Response,
  {first, current, next, last}: PaginationLinks = {},
): void {
  const {params} = response.request
  let path = response.request.path
  if (!path.startsWith('http')) {
    path = `http://canvas.example.com${path}`
  }

  const links: string[] = []

  if (first) {
    const query = qs.stringify({...params, page: first})
    links.push(`<${path}?${query}>; rel="first"`)
  }

  if (current) {
    const query = qs.stringify({...params, page: current})
    links.push(`<${path}?${query}>; rel="current"`)
  }

  if (next) {
    const query = qs.stringify({...params, page: next})
    links.push(`<${path}?${query}>; rel="next"`)
  }

  if (last) {
    const query = qs.stringify({...params, page: last})
    links.push(`<${path}?${query}>; rel="last"`)
  }

  response.setHeader('Link', links.join(','))
}
