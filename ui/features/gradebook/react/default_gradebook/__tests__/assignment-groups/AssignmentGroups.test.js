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

import {createGradebook, setFixtureHtml} from '../GradebookSpecHelper'
import sinon from 'sinon'

describe('Gradebook > Assignment Groups', () => {
  let $container
  let gradebook
  let sandbox

  beforeEach(() => {
    sandbox = sinon.createSandbox()
    $container = document.body.appendChild(document.createElement('div'))
    setFixtureHtml($container)
  })

  afterEach(() => {
    gradebook.destroy()
    $container.remove()
    sandbox.restore()
  })

  describe('#updateAssignmentGroups()', () => {
    let assignmentGroups
    let assignments

    beforeEach(() => {
      gradebook = createGradebook()

      assignments = [
        {
          assignment_group_id: '2201',
          assignment_visibility: null,
          id: '2301',
          name: 'Math Assignment',
          only_visible_to_overrides: false,
          points_possible: 10,
          published: true,
        },

        {
          assignment_group_id: '2202',
          assignment_visibility: ['1102'],
          id: '2302',
          name: 'English Assignment',
          only_visible_to_overrides: true,
          points_possible: 10,
          published: false,
        },
      ]

      assignmentGroups = [
        {
          assignments: assignments.slice(0, 1),
          group_weight: 40,
          id: '2201',
          name: 'Assignments',
          position: 1,
        },

        {
          assignments: assignments.slice(1, 2),
          group_weight: 60,
          id: '2202',
          name: 'Homework',
          position: 2,
        },
      ]
    })

    test('stores the given assignment groups', () => {
      gradebook.updateAssignmentGroups(assignmentGroups)
      const storedGroups = gradebook.assignmentGroupList()
      expect(storedGroups.map(assignmentGroup => assignmentGroup.id)).toEqual(['2201', '2202'])
    })

    test('sets the assignment groups loaded status to true', () => {
      gradebook.updateAssignmentGroups(assignmentGroups)
      expect(gradebook.contentLoadStates.assignmentGroupsLoaded).toBe(true)
    })

    test('renders the view options menu', () => {
      sandbox.spy(gradebook, 'renderViewOptionsMenu')
      gradebook.updateAssignmentGroups(assignmentGroups)
      expect(gradebook.renderViewOptionsMenu.callCount).toBe(1)
    })

    test('renders the view options menu after storing the assignment groups', () => {
      sandbox.stub(gradebook, 'renderViewOptionsMenu').callsFake(() => {
        const storedGroups = gradebook.assignmentGroupList()
        expect(storedGroups).toHaveLength(2)
      })
      gradebook.updateAssignmentGroups(assignmentGroups)
    })

    test('renders the view options menu after updating the assignment groups loaded status', () => {
      sandbox.stub(gradebook, 'renderViewOptionsMenu').callsFake(() => {
        expect(gradebook.contentLoadStates.assignmentGroupsLoaded).toBe(true)
      })
      gradebook.updateAssignmentGroups(assignmentGroups)
    })

    test('updates column headers', () => {
      sandbox.spy(gradebook, 'updateColumnHeaders')
      gradebook.updateAssignmentGroups(assignmentGroups)
      expect(gradebook.updateColumnHeaders.callCount).toBe(1)
    })

    test('updates column headers after storing the assignment groups', () => {
      sandbox.stub(gradebook, 'updateColumnHeaders').callsFake(() => {
        const storedGroups = gradebook.assignmentGroupList()
        expect(storedGroups).toHaveLength(2)
      })
      gradebook.updateAssignmentGroups(assignmentGroups)
    })

    test('updates column headers after updating the assignment groups loaded status', () => {
      sandbox.stub(gradebook, 'updateColumnHeaders').callsFake(() => {
        expect(gradebook.contentLoadStates.assignmentGroupsLoaded).toBe(true)
      })
      gradebook.updateAssignmentGroups(assignmentGroups)
    })

    test('updates essential data load status', () => {
      sandbox.spy(gradebook, '_updateEssentialDataLoaded')
      gradebook.updateAssignmentGroups(assignmentGroups)
      expect(gradebook._updateEssentialDataLoaded.callCount).toBe(1)
    })

    test('updates essential data load status after updating the assignment groups loaded status', () => {
      sandbox.stub(gradebook, '_updateEssentialDataLoaded').callsFake(() => {
        expect(gradebook.contentLoadStates.assignmentGroupsLoaded).toBe(true)
      })
      gradebook.updateAssignmentGroups(assignmentGroups)
    })

    test.skip('updates essential data load status after rendering filters', () => {
      sandbox.stub(gradebook, '_updateEssentialDataLoaded').callsFake(() => {
        expect(gradebook.updateColumnHeaders.callCount).toBe(1)
      })
      gradebook.updateAssignmentGroups(assignmentGroups)
    })
  })
})
