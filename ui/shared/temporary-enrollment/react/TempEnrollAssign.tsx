/*
 * Copyright (C) 2023 - present Instructure, Inc.
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

import React, {createRef, useEffect, useMemo, useRef, useState} from 'react'
import type {ChangeEvent, Dispatch, SetStateAction, SyntheticEvent} from 'react'
import {useScope as createI18nScope} from '@canvas/i18n'
import {ScreenReaderContent} from '@instructure/ui-a11y-content'
import {Grid} from '@instructure/ui-grid'
import {IconArrowOpenStartLine} from '@instructure/ui-icons'
import {Text} from '@instructure/ui-text'
import {DateTimeInput} from '@instructure/ui-date-time-input'
import doFetchApi from '@canvas/do-fetch-api-effect'
import {Spinner} from '@instructure/ui-spinner'
import RoleSearchSelect from './RoleSearchSelect'
import {Alert} from '@instructure/ui-alerts'
import {Button} from '@instructure/ui-buttons'
import {EnrollmentTree} from './EnrollmentTree'
import {Flex} from '@instructure/ui-flex'
import {
  generateDateTimeMessage,
  getDayBoundaries,
  getFromLocalStorage,
  handleCollectSelectedEnrollments,
  removeStringAffix,
  safeDateConversion,
  updateLocalStorageObject,
} from './util/helpers'
import useDateTimeFormat from '@canvas/use-date-time-format-hook'
import {createAnalyticPropsGenerator, setAnalyticPropsOnRef} from './util/analytics'
import type {
  Course,
  Enrollment,
  EnrollmentType,
  NodeStructure,
  RolePermissions,
  Role,
  SelectedEnrollment,
  TemporaryEnrollmentPairing,
  User,
} from './types'
import {MAX_ALLOWED_COURSES_PER_PAGE, MODULE_NAME, RECIPIENT} from './types'
import {showFlashError} from '@canvas/alerts/react/FlashAlert'
import type {GlobalEnv} from '@canvas/global/env/GlobalEnv.d'
import type {EnvCommon} from '@canvas/global/env/EnvCommon'
import {TempEnrollAvatar} from './TempEnrollAvatar'
import {
  createEnrollment,
  createTemporaryEnrollmentPairing,
  deleteEnrollment,
  getTemporaryEnrollmentPairing,
} from './api/enrollment'
import './TempEnrollCustom.css'
import EnrollmentStateSelect, {
  type EnrollmentStateOption,
  enrollmentStates,
  getLabelForState,
} from './EnrollmentStateSelect'
import {captureException} from '@sentry/browser'
import type {Checkbox} from '@instructure/ui-checkbox'

declare const ENV: GlobalEnv & EnvCommon

const I18n = createI18nScope('temporary_enrollment')

// initialize analytics props
const analyticProps = createAnalyticPropsGenerator(MODULE_NAME)

interface EnrollmentRole {
  id: string
  base_role_name: string
}

export interface Props {
  enrollments: User[]
  user: User
  rolePermissions: RolePermissions
  roles: Role[]
  goBack: Function
  doSubmit: () => boolean
  setEnrollmentStatus: Function
  isInAssignEditMode: boolean
  enrollmentType: EnrollmentType
  tempEnrollmentsPairing?: Enrollment[] | null
}

interface RoleChoice {
  id: string
  name: string
}

interface DateErrors {
  invalidStart: boolean
  invalidEnd: boolean
  wrongOrder: boolean
}

interface StoredData {
  roleChoice: RoleChoice
  startDate: Date
  endDate: Date
  stateChoice: EnrollmentStateOption
}

type RoleName =
  | 'StudentEnrollment'
  | 'TaEnrollment'
  | 'TeacherEnrollment'
  | 'DesignerEnrollment'
  | 'ObserverEnrollment'
type PermissionName = 'teacher' | 'ta' | 'student' | 'observer' | 'designer'

const rolePermissionMapping: Record<RoleName, PermissionName> = {
  StudentEnrollment: 'student',
  TaEnrollment: 'ta',
  TeacherEnrollment: 'teacher',
  DesignerEnrollment: 'designer',
  ObserverEnrollment: 'observer',
}

export const tempEnrollAssignData = 'tempEnrollAssignData'
export const defaultRoleChoice: RoleChoice = {
  id: '',
  name: '',
}

// get data from local storage or set defaults
export function getStoredData(roles: Role[]): StoredData {
  const rawStoredData: Partial<StoredData> =
    getFromLocalStorage<StoredData>(tempEnrollAssignData) || {}

  const teacherRole = roles.find(
    role => role.base_role_name === 'TeacherEnrollment' && role.name === 'TeacherEnrollment',
  )
  const roleChoice: RoleChoice = teacherRole
    ? {
        id: teacherRole.id,
        name: removeStringAffix(teacherRole.base_role_name, 'Enrollment'),
      }
    : defaultRoleChoice

  const [defaultStartDate, defaultEndDate] = getDayBoundaries()
  const parsedStartDate = safeDateConversion(rawStoredData.startDate)
  const parsedEndDate = safeDateConversion(rawStoredData.endDate)

  return {
    roleChoice: rawStoredData.roleChoice || roleChoice,
    startDate: parsedStartDate || defaultStartDate,
    endDate: parsedEndDate || defaultEndDate,
    stateChoice: rawStoredData.stateChoice || 'deleted',
  }
}

interface EnrollmentAndUserProps {
  enrollmentProps: User[]
  userProps: User
}

interface EnrollmentAndUserContextProps {
  enrollmentType: EnrollmentType
  enrollments: User[]
  user: User
}

/**
 * Determine the user based on the context type (provider or recipient)
 *
 * This function is needed to handle cases where an enrollment is coming from the
 * context of a recipient via TempEnrollEdit. In those cases, it returns the
 * provider’s view of the assignment component.
 *
 * @param {Props} props Component props
 * @returns {Object} Enrollment and user props
 */
export function getEnrollmentAndUserProps(
  props: EnrollmentAndUserContextProps,
): EnrollmentAndUserProps {
  const {enrollmentType, enrollments, user} = props
  const enrollmentProps = enrollmentType === RECIPIENT ? [user] : enrollments
  const userProps = enrollmentType === RECIPIENT ? enrollments[0] : user

  return {enrollmentProps, userProps}
}

export function isEnrollmentMatch(
  tempEnrollment: Enrollment,
  sectionId: string,
  userId: string,
  roleId: string,
): boolean {
  return (
    tempEnrollment.course_section_id === sectionId &&
    tempEnrollment.user.id === userId &&
    tempEnrollment.role_id === roleId
  )
}

export function isMatchFound(
  sectionIds: string[],
  tempEnrollment: Enrollment,
  userId: string,
  roleId: string,
): boolean {
  for (const sectionId of sectionIds) {
    if (isEnrollmentMatch(tempEnrollment, sectionId, userId, roleId)) {
      return true
    }
  }
  return false
}

export const deleteMultipleEnrollmentsByNoMatch = (
  tempEnrollments: Enrollment[],
  sectionIds: string[],
  enrollmentUsers: User[],
  roleId: string,
): Promise<void>[] => {
  const deletionPromises: Promise<void>[] = []
  for (const user of enrollmentUsers) {
    for (const tempEnrollment of tempEnrollments) {
      if (!isMatchFound(sectionIds, tempEnrollment, user.id, roleId)) {
        deletionPromises.push(deleteEnrollment(tempEnrollment.course_id, tempEnrollment.id))
      }
    }
  }
  return deletionPromises
}

export function TempEnrollAssign(props: Props) {
  const storedData = getStoredData(props.roles)

  const [errorMsg, setErrorMsg] = useState('')
  const [enrollmentsByCourse, setEnrollmentsByCourse] = useState<Course[]>([])
  const [loading, setLoading] = useState(true)
  const [startDate, setStartDate] = useState<Date>(storedData.startDate)
  const [endDate, setEndDate] = useState<Date>(storedData.endDate)
  const [roleChoice, setRoleChoice] = useState<RoleChoice>(storedData.roleChoice)
  const [stateChoice, setStateChoice] = useState<EnrollmentStateOption>(storedData.stateChoice)
  const [dateErrors, setDateErrors] = useState<DateErrors>({
    invalidEnd: false,
    invalidStart: false,
    wrongOrder: false,
  })
  const [isInvalidRole, setIsInvalidRole] = useState<boolean>(false)

  const startDateRef = useRef<HTMLElement | null>(null)
  const endDateRef = useRef<HTMLElement | null>(null)
  const treeRef = createRef<HTMLElement>()
  const roleRef = useRef<HTMLElement | null>(null)

  // reminders …
  // enrollmentProps = recipient user object
  // userProps = provider user object
  const {enrollmentProps, userProps} = getEnrollmentAndUserProps(props)

  const roleOptions: JSX.Element[] = []

  // using useMemo to compute and memoize roleLabel thus avoiding unnecessary re-renders
  const roleLabel = useMemo(() => {
    const selectedRole = props.roles.find(role => role.id === roleChoice.id)

    return selectedRole ? selectedRole.label : I18n.t('ROLE')
  }, [props.roles, roleChoice.id])

  const formatDateTime = useDateTimeFormat('date.formats.full_with_weekday')

  // load data from tempEnrollmentsPairing if it exists
  useEffect(() => {
    if (props.tempEnrollmentsPairing && props.tempEnrollmentsPairing.length > 0) {
      const firstEnrollment = props.tempEnrollmentsPairing[0]
      const roleId = firstEnrollment.role_id
      const matchedRole = props.roles.find(role => role.id === roleId)
      if (matchedRole) {
        const roleName = removeStringAffix(matchedRole.base_role_name, 'Enrollment')
        setRoleChoice({
          id: roleId,
          name: roleName,
        })
      }
      if (firstEnrollment.start_at) {
        setStartDate(new Date(firstEnrollment.start_at))
      }
      if (firstEnrollment.end_at) {
        setEndDate(new Date(firstEnrollment.end_at))
      }
      getTemporaryEnrollmentPairing(ENV.ACCOUNT_ID, firstEnrollment.temporary_enrollment_pairing_id)
        .then(tempEnrollmentPairing => {
          const enrollmentState = tempEnrollmentPairing?.ending_enrollment_state
          const matchedState = enrollmentStates.find(state => state.value === enrollmentState)
          if (matchedState) {
            setStateChoice(matchedState.value)
          }
        })
        .catch(error => {
          console.error('Error fetching temporary enrollment pairing:', error)
          captureException(error)
        })
    }
  }, [props.tempEnrollmentsPairing, props.roles])

  useEffect(() => {
    const fetchData = async () => {
      try {
        let data: Course[] = []
        let next_page: string | undefined
        let num_pages = 0
        do {
          const {json, link} = await doFetchApi<Course[]>({
            path: `/api/v1/users/${userProps.id}/courses`,
            params: {
              enrollment_state: 'active',
              include: ['sections', 'term'],
              per_page: MAX_ALLOWED_COURSES_PER_PAGE,
              ...(ENV.ACCOUNT_ID !== ENV.ROOT_ACCOUNT_ID && {account_id: ENV.ACCOUNT_ID}),
              ...(next_page && {page: next_page}),
            },
          })
          data = data.concat(json!)
          next_page = link?.next?.page
        } while (++num_pages < 10 && next_page)
        setEnrollmentsByCourse(data)
      } catch (error: any) {
        showFlashError(
          I18n.t('There was an error while requesting user enrollments, please try again'),
        )(error)
      } finally {
        setLoading(false)
      }
    }
    fetchData()
  }, [userProps.id])

  /**
   * Handle change to date value in the DateTimeInput component
   *
   * Update the date state and localStorage values
   *
   * @param {SyntheticEvent<Element, Event>} _event Event object
   * @param {Dispatch<SetStateAction<Date>>} setDateState React state setter
   * @param {string} localStorageKey localStorage key to update
   * @param {string} [dateValue] Optional date value, which may not be a valid date
   *                             (e.g. bad user input or corrupted localStorage value)
   * @returns {void}
   */
  const handleDateChange = (
    _event: SyntheticEvent<Element, Event>,
    setDateState: Dispatch<SetStateAction<Date>>,
    localStorageKey: string,
    dateValue?: string,
  ): void => {
    const validatedDate = safeDateConversion(dateValue)

    // only update state and localStorage if the date is valid
    if (validatedDate) {
      setDateState(validatedDate)
      updateLocalStorageObject(tempEnrollAssignData, {[localStorageKey]: validatedDate})
    }

    // set error state for DateTime
    if (localStorageKey === 'startDate') {
      if (validatedDate) {
        if (validatedDate.getTime() <= endDate.getTime()) {
          setDateErrors({...dateErrors, invalidStart: false, wrongOrder: false})
        } else {
          setDateErrors({...dateErrors, invalidStart: false, wrongOrder: true})
        }
      } else {
        setDateErrors({...dateErrors, invalidStart: !validatedDate})
      }
    } else {
      if (validatedDate) {
        if (startDate.getTime() <= validatedDate.getTime()) {
          setDateErrors({...dateErrors, invalidEnd: false, wrongOrder: false})
        } else {
          setDateErrors({...dateErrors, invalidEnd: false, wrongOrder: true})
        }
      } else {
        setDateErrors({...dateErrors, invalidEnd: !validatedDate})
      }
    }
  }

  const handleStartDateChange = (event: SyntheticEvent<Element, Event>, dateValue?: string) => {
    handleDateChange(event, setStartDate, 'startDate', dateValue)
  }

  const handleEndDateChange = (event: SyntheticEvent<Element, Event>, dateValue?: string) => {
    handleDateChange(event, setEndDate, 'endDate', dateValue)
  }

  const handleRoleSearchChange = (_event: ChangeEvent, selectedOption: {id: string}) => {
    const foundRole: EnrollmentRole | undefined = props.roles.find(
      role => role.id === selectedOption.id,
    )
    const name = foundRole ? removeStringAffix(foundRole.base_role_name, 'Enrollment') : ''

    setRoleChoice({
      id: selectedOption.id,
      name,
    })

    updateLocalStorageObject(tempEnrollAssignData, {
      roleChoice: {
        id: selectedOption.id,
        name,
      },
    })
  }

  const handleEnrollmentStateChange = (selectedOption: EnrollmentStateOption) => {
    setStateChoice(selectedOption)
    updateLocalStorageObject(tempEnrollAssignData, {
      stateChoice: selectedOption,
    })
  }

  const handleCreateTempEnroll = async (tree: NodeStructure[]): Promise<void> => {
    const submitEnrolls = handleCollectSelectedEnrollments(tree, enrollmentsByCourse, roleChoice)
    // set focus if an error appears
    if (dateErrors.invalidStart || endDate.getTime() <= startDate.getTime()) {
      startDateRef.current?.focus()
    } else if (roleChoice.id === '' || isInvalidRole) {
      roleRef.current?.focus()
    } else if (dateErrors.invalidEnd) {
      endDateRef.current?.focus()
    } else if (submitEnrolls.length === 0) {
      treeRef.current?.focus()
    } else {
      // no errors; process enrollments
      setLoading(true)
      await handleProcessEnrollments(submitEnrolls)
      return
    }
    props.setEnrollmentStatus(false, false, false)
  }

  const handleProcessEnrollments = async (submitEnrolls: SelectedEnrollment[]): Promise<void> => {
    let success: boolean = false
    try {
      setErrorMsg('')
      // @ts-expect-error
      const pairingPromises = []
      enrollmentProps.forEach(() => {
        pairingPromises.push(createTemporaryEnrollmentPairing(ENV.ACCOUNT_ID, stateChoice))
      })
      const temporaryEnrollmentPairings: TemporaryEnrollmentPairing[] = await Promise.all(
        // @ts-expect-error
        pairingPromises,
      )

      if (props.tempEnrollmentsPairing && props.tempEnrollmentsPairing.length >= 1) {
        // delete any enrollments that were not selected
        const sectionIds: string[] = submitEnrolls.map(
          (enroll: SelectedEnrollment) => enroll.section,
        )
        await Promise.all(
          deleteMultipleEnrollmentsByNoMatch(
            props.tempEnrollmentsPairing,
            sectionIds,
            enrollmentProps,
            roleChoice.id,
          ),
        )
      }
      // iterate through the form’s selected enrollments
      const createPromises: Promise<void>[] = []
      for (const index in enrollmentProps) {
        submitEnrolls.forEach(enroll => {
          // create all selected enrollments
          createPromises.push(
            createEnrollment(
              enroll.section,
              enrollmentProps[index].id,
              userProps.id,
              temporaryEnrollmentPairings[index].id,
              enroll.limit_privileges_to_course_section,
              startDate,
              endDate,
              roleChoice.id,
            ),
          )
        })
      }
      await Promise.all(createPromises)
      success = true
    } catch (error) {
      if (error instanceof Error) {
        setErrorMsg(error.message)
      } else {
        setErrorMsg(I18n.t('An unexpected error occurred, please try again later'))
      }
      success = false
    } finally {
      // if there is no pairing, we are creating a new enrollment
      const isUpdate = props.tempEnrollmentsPairing != null
      const isMultiple = props.enrollments.length > 1
      props.setEnrollmentStatus(success, isUpdate, isMultiple)
      // only set loading state if modal is still open
      if (!success) {
        setLoading(false)
      }
    }
  }

  const handleGoBack = () => {
    props.goBack()
  }

  for (const role of props.roles) {
    const permissionName = rolePermissionMapping[role.base_role_name as RoleName]

    if (permissionName) {
      const hasPermission = props.rolePermissions[permissionName]

      if (hasPermission) {
        roleOptions.push(
          <RoleSearchSelect.Option
            key={role.id}
            id={role.id}
            value={role.id}
            label={role.label}
            aria-label={role.id}
          />,
        )
      }
    }
  }

  if (loading) {
    return (
      <Flex justifyItems="center" alignItems="center">
        <Spinner renderTitle={I18n.t('Retrieving user enrollments')} />
      </Flex>
    )
  }

  return (
    <>
      <Flex gap="medium" direction="column">
        {!props.isInAssignEditMode && (
          <Flex.Item overflowY="visible">
            <Button
              onClick={handleGoBack}
              // @ts-expect-error
              renderIcon={IconArrowOpenStartLine}
              {...analyticProps('Back')}
            >
              {I18n.t('Back')}
            </Button>
          </Flex.Item>
        )}
        <Flex.Item>
          <TempEnrollAvatar user={userProps}>
            {I18n.t(
              {
                one: '%{enroll} will receive temporary enrollments from %{user}',
                other: '%{count} users will receive temporary enrollments from %{user}',
              },
              {
                count: enrollmentProps.length,
                enroll: enrollmentProps[0].name,
                user: userProps.name,
              },
            )}
          </TempEnrollAvatar>
        </Flex.Item>
        {errorMsg && (
          <Flex.Item shouldGrow={true}>
            <Alert variant="error" margin="0">
              {errorMsg}
            </Alert>
          </Flex.Item>
        )}
        <Flex.Item shouldGrow={true} overflowY="visible">
          <Grid startAt="medium">
            <Grid.Row vAlign="top">
              <Grid.Col id="roleSearchSelectGridCol">
                <RoleSearchSelect
                  noResultsLabel={I18n.t('No roles available')}
                  noSearchMatchLabel={I18n.t('No matching roles')}
                  id="termFilter"
                  placeholder={I18n.t('Select a Role')}
                  isLoading={false}
                  label={I18n.t('Select role')}
                  value={roleChoice.id}
                  onChange={handleRoleSearchChange}
                  setRef={(ref: HTMLElement) => {
                    roleRef.current = ref
                  }}
                  invalidRole={(isInvalid: boolean) => setIsInvalidRole(isInvalid)}
                >
                  {roleOptions}
                </RoleSearchSelect>
              </Grid.Col>
              <Grid.Col width={8}>
                <DateTimeInput
                  timezone={ENV.TIMEZONE}
                  data-testid="start-date-input"
                  layout="columns"
                  isRequired={true}
                  description={
                    <ScreenReaderContent>
                      {I18n.t(
                        {one: 'Start Date for %{enroll}', other: 'Start Date for %{count} users'},
                        {count: enrollmentProps.length, enroll: enrollmentProps[0].name},
                      )}
                    </ScreenReaderContent>
                  }
                  dateRenderLabel={I18n.t('Begins On')}
                  timeRenderLabel={I18n.t('Time')}
                  prevMonthLabel={I18n.t('Prev')}
                  nextMonthLabel={I18n.t('Next')}
                  value={startDate.toISOString()}
                  onChange={handleStartDateChange}
                  messages={generateDateTimeMessage({
                    value: startDate.toISOString(),
                    isInvalid: dateErrors.invalidStart,
                    wrongOrder: dateErrors.wrongOrder,
                  })}
                  showMessages={false}
                  invalidDateTimeMessage={I18n.t('The chosen date and time is invalid.')}
                  dateInputRef={ref => {
                    startDateRef.current = ref
                    setAnalyticPropsOnRef(ref, analyticProps('StartDate'))
                  }}
                  timeInputRef={ref => {
                    setAnalyticPropsOnRef(ref, analyticProps('StartTime'))
                  }}
                />
              </Grid.Col>
            </Grid.Row>
            <Grid.Row vAlign="top">
              <Grid.Col width={8}>
                <DateTimeInput
                  timezone={ENV.TIMEZONE}
                  data-testid="end-date-input"
                  layout="columns"
                  isRequired={true}
                  description={
                    <ScreenReaderContent>
                      {I18n.t(
                        {one: 'End Date for %{enroll}', other: 'End Date for %{count} users'},
                        {count: enrollmentProps.length, enroll: enrollmentProps[0].name},
                      )}
                    </ScreenReaderContent>
                  }
                  dateRenderLabel={I18n.t('Until')}
                  timeRenderLabel={I18n.t('Time')}
                  prevMonthLabel={I18n.t('Prev')}
                  nextMonthLabel={I18n.t('Next')}
                  value={endDate.toISOString()}
                  onChange={handleEndDateChange}
                  messages={generateDateTimeMessage({
                    value: endDate.toISOString(),
                    isInvalid: dateErrors.invalidEnd,
                    wrongOrder: false,
                  })}
                  showMessages={false}
                  invalidDateTimeMessage={I18n.t('The chosen date and time is invalid.')}
                  dateInputRef={ref => setAnalyticPropsOnRef(ref, analyticProps('EndDate'))}
                  timeInputRef={ref => setAnalyticPropsOnRef(ref, analyticProps('EndTime'))}
                />
              </Grid.Col>
              <Grid.Col>
                <EnrollmentStateSelect
                  label="Ending enrollment state"
                  onChange={handleEnrollmentStateChange}
                  value={stateChoice}
                />
              </Grid.Col>
            </Grid.Row>
          </Grid>
        </Flex.Item>
        <Flex.Item shouldGrow={true} overflowY="visible">
          <Flex gap="x-small" direction="column">
            <Flex.Item shouldGrow={true}>
              <Text as="p" data-testid="temp-enroll-summary">
                {I18n.t(
                  {
                    one: 'Canvas will enroll %{recipient} as a %{role} in the selected courses of %{source} from %{start} - %{end} with an ending enrollment state of %{state}',
                    other:
                      'Canvas will enroll %{count} users as a %{role} in the selected courses of %{source} from %{start} - %{end} with an ending enrollment state of %{state}',
                  },
                  {
                    count: enrollmentProps.length,
                    recipient: enrollmentProps[0].name,
                    role: roleLabel,
                    source: userProps.name,
                    start: formatDateTime(startDate),
                    end: formatDateTime(endDate),
                    state: getLabelForState(stateChoice),
                  },
                )}
              </Text>
            </Flex.Item>
            <Flex.Item shouldGrow={true} overflowY="visible">
              {props.doSubmit() ? (
                <EnrollmentTree
                  enrollmentsByCourse={enrollmentsByCourse}
                  roles={props.roles}
                  selectedRole={roleChoice}
                  createEnroll={handleCreateTempEnroll}
                  elementRef={treeRef}
                />
              ) : (
                <EnrollmentTree
                  enrollmentsByCourse={enrollmentsByCourse}
                  roles={props.roles}
                  selectedRole={roleChoice}
                  tempEnrollmentsPairing={props.tempEnrollmentsPairing}
                  elementRef={treeRef}
                />
              )}
            </Flex.Item>
          </Flex>
        </Flex.Item>
      </Flex>
    </>
  )
}
