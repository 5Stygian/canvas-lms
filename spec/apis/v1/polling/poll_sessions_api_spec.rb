# frozen_string_literal: true

#
# Copyright (C) 2014 Instructure, Inc.
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
#

require_relative "../../api_spec_helper"

describe Polling::PollSessionsController, type: :request do
  before :once do
    course_with_teacher active_all: true
    @section = @course.course_sections.first
  end

  describe "GET index" do
    before :once do
      @poll = @teacher.polls.create!(question: "Example Poll")
      3.times do
        @poll.poll_sessions.create!(course: @course, course_section: @section)
      end
    end

    def get_index(raw = false, data = {}, header = {})
      helper = method(raw ? :raw_api_call : :api_call)
      helper.call(:get,
                  "/api/v1/polls/#{@poll.id}/poll_sessions",
                  { controller: "polling/poll_sessions",
                    action: "index",
                    format: "json",
                    poll_id: @poll.id.to_s },
                  data,
                  header)
    end

    it "returns all existing poll sessions" do
      json = get_index
      poll_sessions_json = json["poll_sessions"]
      session_ids = @poll.poll_sessions.pluck(:id)
      expect(poll_sessions_json.size).to eq 3

      poll_sessions_json.each do |session|
        expect(session_ids).to include(session["id"].to_i)
        expect(session["is_published"]).to be_falsey
      end
    end

    it "paginates to the jsonapi standard if requested" do
      json = get_index(false, {}, "Accept" => "application/vnd.api+json")
      poll_sessions_json = json["poll_sessions"]
      session_ids = @poll.poll_sessions.pluck(:id)

      expect(poll_sessions_json.size).to eq 3

      poll_sessions_json.each do |session|
        expect(session_ids).to include(session["id"].to_i)
        expect(session["is_published"]).to be_falsey
      end

      expect(json).to have_key("meta")
      expect(json["meta"]).to have_key("pagination")
      expect(json["meta"]["primaryCollection"]).to eq "poll_sessions"
    end
  end

  describe "GET show" do
    def create_submission(choice)
      student = student_in_course(active_user: true).user
      @poll_session.poll_submissions.create!(
        poll: @poll,
        user: student,
        poll_choice: choice
      )
    end

    before :once do
      @poll = @teacher.polls.create!(question: "An Example Poll")
      @poll_session = @poll.poll_sessions.new(course: @course, course_section: @section)
      @poll_session.publish!
    end

    def get_show(raw = false, data = {})
      helper = method(raw ? :raw_api_call : :api_call)
      helper.call(:get,
                  "/api/v1/polls/#{@poll.id}/poll_sessions/#{@poll_session.id}",
                  { controller: "polling/poll_sessions",
                    action: "show",
                    format: "json",
                    poll_id: @poll.id.to_s,
                    id: @poll_session.id.to_s },
                  data)
    end

    it "retrieves the poll session specified" do
      json = get_show
      poll_session_json = json["poll_sessions"].first

      expect(poll_session_json["id"]).to eq @poll_session.id.to_s
      expect(poll_session_json["is_published"]).to be_truthy
    end

    context "as a teacher" do
      it "retrieves the poll session specified even if closed" do
        @poll_session.close!

        @user = @teacher
        json = get_show
        poll_json = json["poll_sessions"].first
        expect(poll_json["id"]).to eq @poll_session.id.to_s
        expect(poll_json["is_published"]).to be_falsey
      end

      it "embeds the associated poll submissions" do
        choice1 = @poll.poll_choices.create!(text: "Choice A", is_correct: true)
        choice2 = @poll.poll_choices.create!(text: "Choice B", is_correct: false)

        2.times { create_submission(choice1) }
        create_submission(choice2)

        @user = @teacher
        json = get_show
        poll_session_json = json["poll_sessions"].first

        expect(poll_session_json).to have_key("poll_submissions")
        expect(poll_session_json["poll_submissions"].size).to eq 3
      end

      it "shows the results of a current poll session" do
        choice1 = @poll.poll_choices.create!(text: "Choice A", is_correct: true)
        choice2 = @poll.poll_choices.create!(text: "Choice B", is_correct: false)

        3.times { create_submission(choice1) }
        2.times { create_submission(choice2) }

        @user = @teacher
        json = get_show
        poll_session_json = json["poll_sessions"].first

        expect(poll_session_json).to have_key("results")
        expect(poll_session_json["results"][choice1.id.to_s]).to eq 3
        expect(poll_session_json["results"][choice2.id.to_s]).to eq 2
      end
    end

    context "as a student" do
      it "doesn't display if the student isn't enrolled in the associated course or course section" do
        section = @course.course_sections.create!(name: "Some Course Section")
        @poll_session.course_section = section
        @poll_session.save

        student_in_course(active_all: true, course: @course)

        get_show(true)

        expect(response).to have_http_status :forbidden
        @poll_session.reload
        expect(@poll_session.poll_submissions.size).to be_zero
      end

      it "returns has_submitted as true if the student has made a submission" do
        choice = @poll.poll_choices.create!(text: "Choice A", is_correct: true)
        submission = create_submission(choice)

        @user = submission.user
        json = get_show["poll_sessions"].first

        expect(json).to have_key("has_submitted")
        expect(json["has_submitted"]).to be_truthy
      end

      it "doesn't embed the associated poll submissions" do
        choice1 = @poll.poll_choices.create!(text: "Choice A", is_correct: true)
        choice2 = @poll.poll_choices.create!(text: "Choice B", is_correct: false)

        2.times { create_submission(choice1) }
        create_submission(choice2)

        @user = student_in_course(active_user: true).user

        json = get_show["poll_sessions"].first

        expect(json).to have_key("poll_submissions")
        expect(json["poll_submissions"].size).to be_zero
      end

      it "does embed the student's own submission" do
        choice = @poll.poll_choices.create!(text: "Choice A", is_correct: true)
        @user = student_in_course(active_user: true).user

        @poll_session.poll_submissions.create!(
          poll: @poll,
          user: @user,
          poll_choice: choice
        )

        json = get_show["poll_sessions"].first
        expect(json).to have_key("poll_submissions")
        expect(json["poll_submissions"].size).to be(1)
      end

      context "when has_public_results is false" do
        it "doesn't show the results of a current poll session" do
          choice1 = @poll.poll_choices.create!(text: "Choice A", is_correct: true)
          choice2 = @poll.poll_choices.create!(text: "Choice B", is_correct: false)

          3.times { create_submission(choice1) }
          2.times { create_submission(choice2) }

          student = student_in_course(active_user: true).user

          @user = student
          json = get_show
          poll_session_json = json["poll_sessions"].first

          expect(poll_session_json).not_to have_key("results")
        end
      end

      context "when has_public_results is true" do
        it "shows the results of the current poll session" do
          @poll_session.update_attribute(:has_public_results, true)

          choice1 = @poll.poll_choices.create!(text: "Choice A", is_correct: true)
          choice2 = @poll.poll_choices.create!(text: "Choice B", is_correct: false)

          3.times { create_submission(choice1) }
          2.times { create_submission(choice2) }

          student = student_in_course(active_user: true).user

          @user = student
          json = get_show
          poll_session_json = json["poll_sessions"].first

          expect(poll_session_json).to have_key("results")
        end
      end
    end
  end

  describe "POST create" do
    before :once do
      @poll = @teacher.polls.create!(question: "An Example Poll")
    end

    def post_create(params, raw = false)
      helper = method(raw ? :raw_api_call : :api_call)
      helper.call(:post,
                  "/api/v1/polls/#{@poll.id}/poll_sessions",
                  { controller: "polling/poll_sessions",
                    action: "create",
                    format: "json",
                    poll_id: @poll.id.to_s },
                  { poll_sessions: [params] },
                  {},
                  {})
    end

    context "as a teacher" do
      it "creates a poll session successfully" do
        post_create(course_section_id: @section.id, course_id: @course.id, has_public_results: true)
        expect(@poll.poll_sessions.size).to eq 1
        expect(@poll.poll_sessions.first.course_section).to eq @section
        expect(@poll.poll_sessions.first.has_public_results).to be_truthy
      end

      it "defaults has_public_results to false if has_public_results is blank" do
        post_create(course_section_id: @section.id, course_id: @course.id, has_public_results: "")
        expect(@poll.poll_sessions.size).to eq 1
        expect(@poll.poll_sessions.first.course_section).to eq @section
        expect(@poll.poll_sessions.first.has_public_results).to be_falsey
      end

      it "returns an error if the supplied course section is invalid" do
        post_create({ course_section_id: @section.id + 666, course_id: @course.id }, true)

        expect(response).to have_http_status :not_found
        expect(response.body).to match(/The specified resource does not exist/)
      end
    end
  end

  describe "PUT update" do
    before :once do
      @poll = @teacher.polls.create!(question: "An Old Title")
      @poll_session = @poll.poll_sessions.create!(course: @course, course_section: @section)
    end

    def put_update(params, raw = false)
      helper = method(raw ? :raw_api_call : :api_call)

      helper.call(:put,
                  "/api/v1/polls/#{@poll.id}/poll_sessions/#{@poll_session.id}",
                  { controller: "polling/poll_sessions",
                    action: "update",
                    format: "json",
                    poll_id: @poll.id.to_s,
                    id: @poll_session.id.to_s },
                  { poll_sessions: [params] },
                  {},
                  {})
    end

    context "as a teacher" do
      it "updates a session successfully" do
        section = @course.course_sections.create!(name: "Another Section")

        put_update(course_section_id: section.id, has_public_results: true)
        @poll_session.reload
        expect(@poll_session.course_section.id).to eq section.id
        expect(@poll_session.has_public_results).to be_truthy
      end

      it "updates courses and sections gracefully" do
        new_course = Course.create!(name: "New Course")
        new_course.enroll_teacher(@teacher)
        new_section = new_course.course_sections.create!(name: "Another nother section")

        expect(new_course).not_to eq @course

        put_update(course_section_id: new_section.id, course_id: new_course.id)
        @poll_session.reload
        expect(@poll_session.course).to eq new_course
        expect(@poll_session.course_section).to eq new_section
      end
    end

    context "as a student" do
      it "is forbidden" do
        student_in_course(active_all: true, course: @course)
        section = @course.course_sections.create!(name: "Another Section")
        original_id = @poll_session.course_section.id

        put_update({ course_section_id: section.id }, true)

        @poll_session.reload
        expect(response).to have_http_status :forbidden
        expect(@poll_session.course_section.id).not_to eq section.id
        expect(@poll_session.course_section.id).to eq original_id
      end
    end
  end

  describe "GET open" do
    before :once do
      @poll = @teacher.polls.create!(question: "An Old Title")
      @poll_session = @poll.poll_sessions.create!(course: @course, course_section: @section)
    end

    def get_open
      raw_api_call(:get,
                   "/api/v1/polls/#{@poll.id}/poll_sessions/#{@poll_session.id}/open",
                   { controller: "polling/poll_sessions",
                     action: "open",
                     format: "json",
                     poll_id: @poll.id.to_s,
                     id: @poll_session.id.to_s },
                   {},
                   {},
                   {})
    end

    context "as a teacher" do
      it "publishes a poll session successfully" do
        @poll_session.update_attribute(:is_published, false)
        @poll_session.reload
        expect(@poll_session.is_published).to be_falsey

        get_open

        @poll_session.reload
        expect(@poll_session.is_published).to be_truthy
      end

      context "not teaching the course" do
        it "doesn't publish the poll session" do
          course_with_teacher
          @poll_session.update_attribute(:is_published, false)
          @poll_session.reload
          expect(@poll_session.is_published).to be_falsey

          get_open

          expect(response).to have_http_status :forbidden
          @poll_session.reload
          expect(@poll_session.is_published).not_to be_truthy
        end
      end
    end

    context "as a student" do
      it "is forbidden" do
        student_in_course(active_all: true, course: @course)
        @poll_session.update_attribute(:is_published, false)
        @poll_session.reload
        expect(@poll_session.is_published).to be_falsey

        get_open

        @poll_session.reload
        expect(response).to have_http_status :forbidden
        expect(@poll_session.is_published).not_to be_truthy
      end
    end
  end

  describe "GET close" do
    before :once do
      @poll = @teacher.polls.create!(question: "An Old Title")
      @poll_session = @poll.poll_sessions.create!(course: @course, course_section: @section)
      @poll_session.publish!
    end

    def get_close
      raw_api_call(:get,
                   "/api/v1/polls/#{@poll.id}/poll_sessions/#{@poll_session.id}/close",
                   { controller: "polling/poll_sessions",
                     action: "close",
                     format: "json",
                     poll_id: @poll.id.to_s,
                     id: @poll_session.id.to_s },
                   {},
                   {},
                   {})
    end

    context "as a teacher" do
      it "closes a published poll session successfully" do
        get_close

        @poll_session.reload
        expect(@poll_session.is_published).to be_falsey
      end

      context "not teaching the course" do
        it "doesn't close the poll session" do
          course_with_teacher
          @poll_session.update_attribute(:is_published, true)
          @poll_session.reload
          expect(@poll_session.is_published).to be_truthy

          get_close

          expect(response).to have_http_status :forbidden
          @poll_session.reload
          expect(@poll_session.is_published).not_to be_falsey
        end
      end
    end

    context "as a student" do
      it "is forbidden" do
        student_in_course(active_all: true, course: @course)

        get_close

        @poll_session.reload
        expect(response).to have_http_status :forbidden
        expect(@poll_session.is_published).to be_truthy
      end
    end
  end

  describe "GET opened" do
    before :once do
      @course1 = course_model
      @course2 = course_model
      @teacher1 = teacher_in_course(course: @course1).user
      @teacher2 = teacher_in_course(course: @course2).user
      @poll1 = Polling::Poll.create!(user: @teacher1, question: "A Test Poll")
      @poll2 = Polling::Poll.create!(user: @teacher2, question: "Another Test Poll")
    end

    def get_opened(headers = {})
      api_call(:get,
               "/api/v1/poll_sessions/opened",
               { controller: "polling/poll_sessions", action: "opened", format: "json" },
               {},
               headers)
    end

    it "returns all poll sessions available to the current user that are published" do
      @published = @poll1.poll_sessions.create!(course: @course1)
      @published.publish!
      @unenrolled = @poll2.poll_sessions.create!(course: @course2)
      @unenrolled.publish!
      @not_published = @poll1.poll_sessions.create!(course: @course1)

      student_in_course(active_all: true, course: @course1)
      json = get_opened["poll_sessions"]

      session_ids = json.map { |session| session["id"].to_i }

      expect(session_ids).to include(@published.id)
      expect(session_ids).not_to include(@unenrolled.id)
      expect(session_ids).not_to include(@not_published.id)
    end

    it "doesn't return poll sessions for course sections the user is not enrolled in" do
      @published = @poll1.poll_sessions.create!(course: @course1)
      @published.publish!
      @wrong_course_section = @poll1.poll_sessions.create!(course: @course1, course_section: @course1.course_sections.create!(name: "blah"))
      @wrong_course_section.close!

      student_in_course(active_all: true, course: @course1)
      json = get_opened["poll_sessions"]

      session_ids = json.map { |session| session["id"].to_i }

      expect(session_ids).to include(@published.id)
      expect(session_ids).not_to include(@wrong_course_section.id)
    end

    it "paginates to the jsonapi standard if requested" do
      @published = @poll1.poll_sessions.create!(course: @course1)
      @published.publish!
      @unenrolled = @poll2.poll_sessions.create!(course: @course2)
      @unenrolled.publish!
      @not_published = @poll1.poll_sessions.create!(course: @course1)

      student_in_course(active_all: true, course: @course1)
      json = get_opened("Accept" => "application/vnd.api+json")
      sessions = json["poll_sessions"]
      session_ids = sessions.map { |session| session["id"].to_i }

      expect(session_ids).to include(@published.id)
      expect(session_ids).not_to include(@unenrolled.id)
      expect(session_ids).not_to include(@not_published.id)

      expect(json).to have_key("meta")
      expect(json["meta"]).to have_key("pagination")
      expect(json["meta"]["primaryCollection"]).to eq "poll_sessions"
    end
  end

  describe "GET closed" do
    before :once do
      @course1 = course_model
      @course2 = course_model
      @teacher1 = teacher_in_course(course: @course1).user
      @teacher2 = teacher_in_course(course: @course2).user
      @poll1 = Polling::Poll.create!(user: @teacher1, question: "A Test Poll")
      @poll2 = Polling::Poll.create!(user: @teacher2, question: "Another Test Poll")
    end

    def get_closed(headers = {})
      api_call(:get,
               "/api/v1/poll_sessions/closed",
               { controller: "polling/poll_sessions", action: "closed", format: "json" },
               {},
               headers)
    end

    it "returns all poll sessions available to the current user that are closed" do
      @published = @poll1.poll_sessions.create!(course: @course1)
      @published.publish!
      @unenrolled = @poll2.poll_sessions.create!(course: @course2)
      @unenrolled.close!
      @not_published = @poll1.poll_sessions.create!(course: @course1)
      @not_published.close!

      student_in_course(active_all: true, course: @course1)
      json = get_closed["poll_sessions"]

      session_ids = json.map { |session| session["id"].to_i }

      expect(session_ids).to include(@not_published.id)
      expect(session_ids).not_to include(@unenrolled.id)
      expect(session_ids).not_to include(@published.id)
    end

    it "doesn't return poll sessions for course sections the user is not enrolled in" do
      @not_published = @poll1.poll_sessions.create!(course: @course1)
      @not_published.close!
      @wrong_course_section = @poll1.poll_sessions.create!(course: @course1, course_section: @course1.course_sections.create!(name: "blah"))
      @wrong_course_section.close!

      student_in_course(active_all: true, course: @course1)
      json = get_closed["poll_sessions"]

      session_ids = json.map { |session| session["id"].to_i }

      expect(session_ids).to include(@not_published.id)
      expect(session_ids).not_to include(@wrong_course_section.id)
    end

    it "paginates to the jsonapi standard if requested" do
      @published = @poll1.poll_sessions.create!(course: @course1)
      @published.publish!
      @unenrolled = @poll2.poll_sessions.create!(course: @course2)
      @unenrolled.close!
      @not_published = @poll1.poll_sessions.create!(course: @course1)
      @not_published.close!

      student_in_course(active_all: true, course: @course1)
      json = get_closed("Accept" => "application/vnd.api+json")

      sessions = json["poll_sessions"]
      session_ids = sessions.map { |session| session["id"].to_i }

      expect(session_ids).to include(@not_published.id)
      expect(session_ids).not_to include(@unenrolled.id)
      expect(session_ids).not_to include(@published.id)

      expect(json).to have_key("meta")
      expect(json["meta"]).to have_key("pagination")
      expect(json["meta"]["primaryCollection"]).to eq "poll_sessions"
    end
  end
end
