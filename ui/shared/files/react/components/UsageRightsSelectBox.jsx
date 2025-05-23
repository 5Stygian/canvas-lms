/*
 * Copyright (C) 2015 - present Instructure, Inc.
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

import $ from 'jquery'
import React from 'react'
import PropTypes from 'prop-types'
import {useScope as createI18nScope} from '@canvas/i18n'
import filesEnv from '../modules/filesEnv'
import { Text } from '@instructure/ui-text'

const I18n = createI18nScope('usageRightsSelectBox')

function omitEmptyValues(obj) {
  Object.keys(obj).forEach(k => {
    if (obj[k] == null) delete obj[k]
  })
  return obj
}

const CONTENT_OPTIONS = [
  {
    display: I18n.t('Choose usage rights...'),
    value: 'choose',
  },
  {
    display: I18n.t('I hold the copyright'),
    value: 'own_copyright',
  },
  {
    display: I18n.t('I have obtained permission to use this file.'),
    value: 'used_by_permission',
  },
  {
    display: I18n.t('The material is in the public domain'),
    value: 'public_domain',
  },
  {
    display: I18n.t(
      'The material is subject to an exception - e.g. fair use, the right to quote, or others under applicable copyright laws',
    ),
    value: 'fair_use',
  },
  {
    display: I18n.t('The material is licensed under Creative Commons'),
    value: 'creative_commons',
  },
]

export default class UsageRightsSelectBox extends React.Component {
  static propTypes = {
    cc_value: PropTypes.string,
    use_justification: PropTypes.oneOf(Object.values(CONTENT_OPTIONS).map(o => o.value)),
    copyright: PropTypes.string,
    showMessage: PropTypes.bool,
    contextType: PropTypes.string,
    contextId: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
    hideErrors: PropTypes.func,
  }

  state = {
    showTextBox: this.props.use_justification !== 'choose',
    showCreativeCommonsOptions:
      this.props.use_justification === 'creative_commons' && this.props.copyright != null,
    licenseOptions: [],
    showMessage: this.props.showMessage,
    usageRightSelectionValue: this.props.use_justification
      ? this.props.use_justification
      : undefined,
    validationError: false,
  }

  componentDidMount() {
    this.getUsageRightsOptions()
    $(document).on("validateUsageRightsSelectedValue", (_e, data) => {
      this.setValidationError(!!data.error)
    })
  }

  setValidationError(validationError) {
    this.setState({validationError})
  }

  apiUrl() {
    return `/api/v1/${filesEnv.contextType || this.props.contextType}/${
      filesEnv.contextId || this.props.contextId
    }/content_licenses`
  }

  // Exposes the selected values to the outside world.
  getValues() {
    let x
    const obj = {
      use_justification: this.usageRightSelection.value,
      copyright: this.state.showTextBox ? (x = this.copyright) && x.value : undefined,
      cc_license: this.state.showCreativeCommonsOptions
        ? (x = this.creativeCommons) && x.value
        : undefined,
    }

    return omitEmptyValues(obj)
  }

  getUsageRightsOptions() {
    return $.get(this.apiUrl(), data => {
      this.setState({
        licenseOptions: data,
      })
    })
  }

  handleChange(event) {
    this.setState({
      usageRightSelectionValue: event.target.value,
      showTextBox: event.target.value !== 'choose',
      showCreativeCommonsOptions: event.target.value === 'creative_commons',
      showMessage: this.props.showMessage && event.target.value === 'choose',
    })
    if(this.props.hideErrors)
      this.props.hideErrors()
  }

  // This method only really applies to firefox which doesn't handle onChange
  // events on select boxes like every other browser.
  handleChooseKeyPress(event) {
    if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      this.setState(
        {
          usageRightSelectionValue: event.target.value,
        },
        this.handleChange(event),
      )
    }
  }

  renderContentOptions() {
    return CONTENT_OPTIONS.map(contentOption => (
      <option key={contentOption.value} value={contentOption.value}>
        {contentOption.display}
      </option>
    ))
  }

  renderCreativeCommonsOptions() {
    const onlyCC = this.state.licenseOptions.filter(license => license.id.indexOf('cc') === 0)

    return onlyCC.map(license => (
      <option key={license.id} value={license.id}>
        {license.name}
      </option>
    ))
  }

  renderShowCreativeCommonsOptions() {
    return (
      <div className="control-group">
        <label className="control-label" htmlFor="creativeCommonsSelection">
          {I18n.t('Creative Commons License:')}
        </label>
        <div className="control">
          <select
            id="creativeCommonsSelection"
            className="UsageRightsSelectBox__creativeCommons"
            ref={e => (this.creativeCommons = e)}
            defaultValue={this.props.cc_value}
          >
            {this.renderCreativeCommonsOptions()}
          </select>
        </div>
      </div>
    )
  }

  renderShowMessage() {
    const renderShowMessage = (
      <div ref={e => (this.showMessageAlert = e)} className="alert">
        <span>
          <i className="icon-warning" />
          <span style={{paddingLeft: '10px'}}>
            {I18n.t(
              "If you do not select usage rights now, this file will be unpublished after it's uploaded.",
            )}
          </span>
        </span>
      </div>
    )
    return this.state.showMessage ? renderShowMessage : null
  }

  render() {
    return (
      <div className="UsageRightsSelectBox__container">
        <div className="control-group">
          <label className="control-label" htmlFor="usageRightSelector">
            {I18n.t('Usage Rights')}<Text color={this.state.validationError ? 'danger' : 'primary'}>*</Text>:
          </label>
          <div className="controls">
            <select
              id="usageRightSelector"
              className="UsageRightsSelectBox__select"
              onChange={e => this.handleChange(e)}
              onKeyUp={e => this.handleChooseKeyPress(e)}
              ref={e => (this.usageRightSelection = e)}
              value={this.state.usageRightSelectionValue}
            >
              {this.renderContentOptions()}
            </select>
          </div>
          {/* Usage Rights Error Container */}
          <div id="usage_rights_use_justification_errors"></div>
        </div>
        {this.state.showCreativeCommonsOptions && this.renderShowCreativeCommonsOptions()}
        <div className="control-group">
          <label className="control-label" htmlFor="copyrightHolder">
            {I18n.t('Copyright Holder:')}
          </label>
          <div className="controls">
            <input
              id="copyrightHolder"
              type="text"
              ref={e => (this.copyright = e)}
              defaultValue={this.props.copyright}
              placeholder={I18n.t('(c) 2001 Acme Inc.')}
            />
          </div>
        </div>
        {this.renderShowMessage()}
      </div>
    )
  }
}
