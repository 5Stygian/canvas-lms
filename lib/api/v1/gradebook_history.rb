# frozen_string_literal: true

#
# Copyright (C) 2013 - present Instructure, Inc.
#
# This file is part of Canvas.
#
# Canvas is free software: you can redistribute it and/or modify it under
# the terms of the GNU Affero General Public License as published by the Free
# Software Foundation, version 3 of the License.
#
# Canvas is distributed in the hope that it will be useful, but WITHOUT ANY
# WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR
# A PARTICULAR PURPOSE. See the GNU Affero General Public License for more
# details.
#
# You should have received a copy of the GNU Affero General Public License along
# with this program. If not, see <http://www.gnu.org/licenses/>.

module Api::V1
  module GradebookHistory
    include Api
    include Api::V1::Assignment
    include Api::V1::Submission

    def days_json(course, api_context)
      day_hash = Hash.new { |hash, date| hash[date] = { graders: {} } }
      submissions_set(course, api_context)
        .each_with_object(day_hash) { |submission, day| update_graders_hash(day[day_string_for(submission)][:graders], submission, api_context) }
        .each_value do |date_hash|
          compress(date_hash, :graders)
          date_hash[:graders].each { |grader| compress(grader, :assignments) }
        end

      day_hash.map { |date, hash| hash.merge(date:) }.sort_by { |a| a[:date] }.reverse
    end

    def json_for_date(date, course, api_context)
      submissions_set(course, api_context, date:)
        .each_with_object({}) { |sub, memo| update_graders_hash(memo, sub, api_context) }
        .each_value { |grader| compress(grader, :assignments) }
        .values
    end

    def version_json(course, version, api_context, opts = {})
      submission = opts[:submission] || version.versionable
      assignment = opts[:assignment] || submission.assignment
      student = opts[:student] || submission.user
      current_grader = submission.grader || default_grader

      model = version.model
      json = model.without_versioned_attachments do
        submission_attempt_json(model, assignment, api_context.user, api_context.session, course, params)
          .with_indifferent_access
      end
      grader = (json[:grader_id] && json[:grader_id] > 0 && user_cache[json[:grader_id]]) || default_grader

      json.merge(
        grader: grader.name,
        assignment_name: assignment.title,
        user_name: student.name,
        current_grade: submission.grade,
        current_graded_at: submission.graded_at,
        current_grader: current_grader.name
      )
    end

    def versions_json(course, versions, api_context, opts = {})
      # preload for efficiency
      unless opts[:submission]
        ActiveRecord::Associations.preload(versions, :versionable)
        submissions = versions.map(&:versionable)
        ActiveRecord::Associations.preload(versions.map(&:model), :originality_reports)
        ActiveRecord::Associations.preload(submissions, :assignment) unless opts[:assignment]
        ActiveRecord::Associations.preload(submissions, :user) unless opts[:student]
        ActiveRecord::Associations.preload(submissions, :grader)
        ::Submission.bulk_load_versioned_attachments(versions.map(&:model))
      end

      versions.each_with_object([]) do |version, json_versions|
        submission = opts[:submission] || version.versionable
        next unless submission

        assignment = opts[:assignment] || submission.assignment
        student = opts[:student] || submission.user
        json_version = version_json(
          course,
          version,
          api_context,
          submission:,
          assignment:,
          student:
        )
        json_versions << json_version
      end
    end

    def submissions_for(course, api_context, date, grader_id, assignment_id)
      assignment = ::Assignment.find(assignment_id)
      options = { date:, assignment_id:, grader_id: }
      submissions = submissions_set(course, api_context, options)

      # load all versions for the given submissions and back-populate their
      # versionable associations
      submission_index = submissions.index_by(&:id)
      versions = Version.where(versionable_type: "Submission", versionable_id: submissions).order(:number)
      versions.each { |version| version.versionable = submission_index[version.versionable_id] }

      # convert them all to json and then group by submission
      versions = versions_json(course, versions, api_context, assignment:)
      versions_hash = versions.group_by { |version| version[:id] }

      # populate previous_* and new_* keys and convert hash to array of objects
      versions_hash.inject([]) do |memo, (submission_id, submission_versions)|
        prior = ActiveSupport::HashWithIndifferentAccess.new
        filtered_versions = submission_versions.each_with_object([]) do |version, new_array|
          if version[:score] &&
             (prior[:id].nil? || prior[:score] != version[:score])
            if prior[:id].nil? || prior[:graded_at].nil? || version[:graded_at].nil?
              PREVIOUS_VERSION_ATTRS.each { |attr| version[:"previous_#{attr}"] = nil }
            elsif prior[:score] != version[:score]
              PREVIOUS_VERSION_ATTRS.each { |attr| version[:"previous_#{attr}"] = prior[attr] }
            end
            NEW_ATTRS.each { |attr| version[:"new_#{attr}"] = version[attr] }
            new_array << version
          end
          prior.merge!(version.slice(:grade, :score, :graded_at, :grader, :id))
        end.reverse

        memo << { submission_id:, versions: filtered_versions }
      end
    end

    def day_string_for(submission)
      graded_at = submission.graded_at
      return "" if graded_at.nil?

      graded_at.in_time_zone.to_date.as_json
    end

    def submissions_set(course, api_context, options = {})
      collection = ::Submission.for_course(course).order("graded_at DESC")

      if options[:date]
        date = options[:date]
        collection = collection.where("graded_at<? AND graded_at>?", date.end_of_day, date.beginning_of_day)
      else
        collection = collection.where.not(graded_at: nil)
      end

      if (assignment_id = options[:assignment_id])
        collection = collection.where(assignment_id:)
      end

      if (grader_id = options[:grader_id])
        collection = if grader_id.to_s == "0"
                       # yes, this is crazy.  autograded submissions have the grader_id of (quiz_id x -1)
                       collection.where("submissions.grader_id<=0")
                     else
                       collection.where(grader_id:)
                     end
      end

      api_context.paginate(collection)
    end

    private

    PREVIOUS_VERSION_ATTRS = %i[grade graded_at grader].freeze
    NEW_ATTRS = %i[grade graded_at grader score].freeze

    DefaultGrader = Struct.new(:name, :id)
    private_constant :PREVIOUS_VERSION_ATTRS, :NEW_ATTRS, :DefaultGrader

    def default_grader
      @default_grader ||= DefaultGrader.new(I18n.t("gradebooks.history.graded_on_submission", "Graded on submission"), 0)
    end

    def user_cache
      @user_cache ||= Hash.new { |hash, user_id| hash[user_id] = ::User.find(user_id) }
    end

    def assignment_cache
      @assignment_cache ||= Hash.new { |hash, assignment_id| hash[assignment_id] = ::Assignment.find(assignment_id) }
    end

    def update_graders_hash(hash, submission, api_context)
      grader = submission.grader || default_grader
      hash[grader.id] ||= {
        name: grader.name,
        id: grader.id,
        assignments: {}
      }

      hash[grader.id][:assignments][submission.assignment_id] ||= begin
        assignment = assignment_cache[submission.assignment_id]
        assignment_json(assignment, api_context.user, api_context.session)
      end
    end

    def compress(hash, key)
      hash[key] = hash[key].values
    end
  end
end
